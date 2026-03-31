import bcrypt from "bcryptjs";
import { env } from "../config/env";
import { redis, REDIS_KEYS, TTL } from "../config/redis";
import { logger } from "../utils/logger";
import { BadRequestError, GoneError, InternalError, TooManyRequestsError } from "../utils/errors";

const TEXTSMS_URL = "https://sms.textsms.co.ke/api/services/sendsms/";
const OTP_MAX_SEND_ATTEMPTS = 5;
const OTP_MAX_VERIFY_ATTEMPTS = 3;

export interface PendingRegistration {
    name?: string;   // collected during onboarding step 1, not at registration
    phone: string;
    password: string;
    email?: string;
    role: "rider" | "customer" | "admin";
}

function generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// TextSMS expects numbers without the leading '+', e.g. 254712345678
function normalizePhone(phone: string): string {
    return phone.startsWith("+") ? phone.slice(1) : phone;
}

async function sendSms(phone: string, otp: string): Promise<void> {
    const body = {
        apikey: env.TEXTSMS_API_KEY,
        partnerID: parseInt(env.TEXTSMS_PARTNER_ID, 10), // TextSMS requires a number, not a string
        shortcode: env.TEXTSMS_SHORTCODE,
        mobile: normalizePhone(phone),
        message: `Your ${env.APP_NAME} verification code is: ${otp}. It expires in 5 minutes.`,
    };

    logger.info(`[SMS] Sending OTP to ${normalizePhone(phone)} via TextSMS`);

    const res = await fetch(TEXTSMS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errorText = await res.text();
        logger.error(`TextSMS HTTP ${res.status}: ${errorText}`);
        throw new InternalError(`SMS delivery failed (HTTP ${res.status}). Please try again.`);
    }

    // HTTP 200 means the request was accepted — TextSMS body codes are unreliable
    logger.info(`OTP sent to ${phone}`);
}

export const OtpService = {
    /**
     * Generate and send an OTP for any flow. Rate-limited to 5 per hour per phone.
     * In development, OTP is logged to the terminal instead of sending a real SMS
     * unless TEXTSMS_FORCE=true is set in .env.
     */
    send: async (phone: string): Promise<void> => {
        const attemptsKey = REDIS_KEYS.otpAttempts(phone);
        const attempts = await redis.incr(attemptsKey);

        if (attempts === 1) {
            await redis.expire(attemptsKey, TTL.OTP_ATTEMPTS);
        }

        if (attempts > OTP_MAX_SEND_ATTEMPTS) {
            throw new TooManyRequestsError("Too many OTP requests. Please try again in an hour.");
        }

        const otp = generateOtp();
        await redis.setex(REDIS_KEYS.otp(phone), TTL.OTP, otp);

        // if (env.NODE_ENV !== "production" && env.TEXTSMS_FORCE !== "true") {
        //     // In development, skip the real SMS and print the OTP to the terminal.
        //     // Set TEXTSMS_FORCE=true in .env to send real SMS in dev for testing.
        //     logger.info(`[DEV] OTP for ${phone}: ${otp}`);
        //     return;
        // }

        await sendSms(phone, otp);
    },

    /**
     * Validate the OTP. Deletes it from Redis on success so it can't be reused.
     * Throws if expired, not found, or incorrect.
     */
    verify: async (phone: string, otp: string): Promise<void> => {
        const stored = await redis.get(REDIS_KEYS.otp(phone));

        if (!stored) {
            throw new GoneError("OTP expired or not found. Please request a new one.");
        }

        if (stored !== otp) {
            const attemptsKey = REDIS_KEYS.otpVerifyAttempts(phone);
            const failedAttempts = await redis.incr(attemptsKey);

            // Expire the attempts counter alongside the OTP itself
            if (failedAttempts === 1) await redis.expire(attemptsKey, TTL.OTP);

            if (failedAttempts >= OTP_MAX_VERIFY_ATTEMPTS) {
                // Invalidate the OTP so a new one must be requested
                await redis.del(REDIS_KEYS.otp(phone));
                await redis.del(attemptsKey);
                throw new TooManyRequestsError("Too many failed attempts. Please request a new OTP.");
            }

            const remaining = OTP_MAX_VERIFY_ATTEMPTS - failedAttempts;
            throw new BadRequestError(`Invalid OTP. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`);
        }

        // Success — clear OTP and any failed attempt counter
        await redis.del(REDIS_KEYS.otp(phone));
        await redis.del(REDIS_KEYS.otpVerifyAttempts(phone));
    },

    /**
     * Cache registration form data in Redis while the user completes OTP verification.
     * Stored for OTP_PENDING seconds (10 min) — same window as the OTP flow.
     */
    storePendingRegistration: async (data: PendingRegistration): Promise<void> => {
        // Hash the password before caching — never store plaintext credentials in Redis
        const passwordHash = await bcrypt.hash(data.password, 12);
        await redis.setex(
            REDIS_KEYS.otpPendingRegister(data.phone),
            TTL.OTP_PENDING,
            JSON.stringify({ ...data, password: passwordHash })
        );
    },

    getPendingRegistration: async (phone: string): Promise<PendingRegistration | null> => {
        const raw = await redis.get(REDIS_KEYS.otpPendingRegister(phone));
        if (!raw) return null;
        return JSON.parse(raw) as PendingRegistration;
    },

    clearPendingRegistration: async (phone: string): Promise<void> => {
        await redis.del(REDIS_KEYS.otpPendingRegister(phone));
    },
};
