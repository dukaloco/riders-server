import Redis from "ioredis";
import { env } from "./env";
import { logger } from "../utils/logger";

const redisConfig = env.REDIS_URL
    ? {
        // Cloud URL style 
        lazyConnect: true,
        retryStrategy: (times: number) => Math.min(times * 500, 2000),
    }
    : {
        // Manual Host/Port style
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        ...(env.REDIS_PASSWORD && { password: env.REDIS_PASSWORD }),
        tls: env.REDIS_HOST !== "localhost" ? {} : undefined,
        lazyConnect: true,
        retryStrategy: (times: number) => Math.min(times * 500, 2000),
    };

export const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, redisConfig) : new Redis(redisConfig);
export const redisSub = env.REDIS_URL ? new Redis(env.REDIS_URL, redisConfig) : new Redis(redisConfig);

redis.on("connect", () => logger.info("✅ Redis connected"));
redis.on("error", (err) => logger.error("❌ Redis error:", err));
redis.on("close", () => logger.warn("⚠️  Redis connection closed"));

/** True if ioredis must not receive another `.connect()` (would throw). */
function isAlreadyLinked(client: Redis): boolean {
    const s = client.status;
    return s === "connecting" || s === "connect" || s === "ready";
}

export async function connectRedis(): Promise<void> {
    // Another module may have triggered a command before this runs (e.g. rate-limit
    // on first request) — lazyConnect then starts the socket; calling connect() again throws.
    if (!isAlreadyLinked(redis)) await redis.connect();
    if (!isAlreadyLinked(redisSub)) await redisSub.connect();
}

// Redis Key Helpers

export const REDIS_KEYS = {
    riderLocation: (riderId: string) => `rider:location:${riderId}`,
    riderStatus: (riderId: string) => `rider:status:${riderId}`,
    riderSocket: (riderId: string) => `rider:socket:${riderId}`,
    onlineRiders: () => `riders:online`,
    tripLock: (tripId: string) => `trip:lock:${tripId}`,
    rateLimit: (ip: string) => `rate_limit:${ip}`,
    otp: (phone: string) => `otp:${phone}`,
    otpAttempts: (phone: string) => `otp:attempts:${phone}`,
    otpVerifyAttempts: (phone: string) => `otp:verify:attempts:${phone}`,
    otpPendingRegister: (phone: string) => `otp:pending:register:${phone}`,
    otpPendingLogin: (phone: string) => `otp:pending:login:${phone}`,
} as const;

export const TTL = {
    RIDER_LOCATION: 30,
    RIDER_STATUS: 3600,
    RATE_LIMIT: 60,
    TRIP_LOCK: 30,
    OTP: 300,
    OTP_PENDING: 600,
    OTP_ATTEMPTS: 3600,
} as const;
