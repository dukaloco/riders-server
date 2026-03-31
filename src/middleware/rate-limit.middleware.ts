import { Elysia } from "elysia";
import { redis } from "../config/redis";
import { TooManyRequestsError } from "../utils/errors";

interface RateLimitOptions {
    max: number;
    windowSeconds: number;
    message?: string;
    /** Namespace to isolate different limiters — e.g. "auth" vs "api" (default: "api") */
    keyPrefix?: string;
}

export function rateLimitPlugin(options: RateLimitOptions) {
    const {
        max,
        windowSeconds,
        message = "Too many requests. Please slow down.",
        keyPrefix = "api",
    } = options;

    return new Elysia({ name: `rate-limit:${keyPrefix}:${max}:${windowSeconds}` })
        .onRequest(async ({ request, set }) => {
            const ip =
                request.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
                request.headers.get("x-real-ip") ??
                "unknown";

            const key = `rate_limit:${keyPrefix}:${ip}`;
            const count = await redis.incr(key);

            if (count === 1) {
                await redis.expire(key, windowSeconds);
            }

            if (count > max) {
                set.headers["Retry-After"] = String(windowSeconds);
                throw new TooManyRequestsError(message);
            }
        });
}
