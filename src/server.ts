import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";

import { env } from "./config/env";
import { connectDB } from "./config/db";
import { connectRedis } from "./config/redis";
import { logger } from "./utils/logger";
import { AppError } from "./utils/errors";
import { rateLimitPlugin } from "./middleware/rate-limit.middleware";

// Routes & Plugins
import { adminRoutes } from "./routes/admin.routes";
import { authRoutes } from "./routes/auth.routes";
import { profileRoutes } from "./routes/profile.routes";
import { riderRoutes } from "./routes/rider.routes";
import { tripRoutes } from "./routes/trip.routes";
import { socketPlugin } from "./sockets/socket.plugin";

// Background jobs
import { startRiderCleanupJob } from "./jobs/runRiderCleanup.job";
import { startTripTimeoutJob } from "./jobs/tripTimeout.job";

const allowedOrigins = env.CORS_ORIGINS.split(",").map((o) => o.trim());
const isProd = env.NODE_ENV === "production";

const app = new Elysia({ serve: { maxRequestBodySize: 10 * 1024 * 1024 } }) // 10 MB hard limit
    // ─── Security headers ─────────────────────────────────────────────────────
    .onRequest(({ set }) => {
        set.headers["X-Content-Type-Options"] = "nosniff";
        set.headers["X-Frame-Options"] = "DENY";
        set.headers["X-XSS-Protection"] = "0"; // Disable legacy XSS filter — CSP is the modern replacement
        set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
        set.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()";
        set.headers["Cross-Origin-Resource-Policy"] = "same-origin";
        set.headers["Cross-Origin-Opener-Policy"] = "same-origin";
        set.headers["Content-Security-Policy"] =
            "default-src 'none'; frame-ancestors 'none'";
        if (isProd) {
            set.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
        }
    })

    // ─── Global rate limiting (100 req / min per IP) ─────────────────────────
    .use(rateLimitPlugin({
        max: 100,
        windowSeconds: 60,
        keyPrefix: "global",
        message: "Rate limit exceeded. Please slow down.",
    }))

    // ─── CORS ─────────────────────────────────────────────────────────────────
    .use(cors({
        origin: (request) => {
            const origin = request.headers.get("origin") ?? "";
            return allowedOrigins.includes(origin);
        },
        allowedHeaders: ["Content-Type", "Authorization"],
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        credentials: false,
    }))

    // ─── Swagger (dev only — fully blocked in production) ────────────────────
    .use(swagger({
        path: "/swagger",
        documentation: {
            info: {
                title: "Riders API",
                version: "1.0.0",
                description: "Riders Delivery App — Rider & Customer API",
            },
        },
        ...(isProd && {
            // Return 404 for both the spec and the UI in production
            exclude: [/swagger/],
        }),
    }))

    // ─── Health check ─────────────────────────────────────────────────────────
    .get("/health", () => ({
        status: "ok",
        service: env.APP_NAME,
        timestamp: new Date().toISOString(),
        // Never reveal environment in production
        ...((!isProd) && { environment: env.NODE_ENV }),
    }))

    // ─── Sockets ──────────────────────────────────────────────────────────────
    .use(socketPlugin)

    // ─── API Routes ───────────────────────────────────────────────────────────
    .use(authRoutes)
    .use(profileRoutes)
    .use(riderRoutes)
    .use(tripRoutes)
    .use(adminRoutes)

    // ─── Global error handler ─────────────────────────────────────────────────
    // IMPORTANT: Return plain objects (not JSON.stringify strings).
    // Elysia auto-serializes objects → application/json.
    // Returning a string forces text/plain regardless of set.headers.
    .onError(({ code, error, set }) => {
        const err = error as any;

        // Duck-type AppError subclasses (statusCode + code properties).
        if (typeof err?.statusCode === "number" && typeof err?.code === "string") {
            set.status = err.statusCode;
            return {
                success: false,
                code: err.code,
                message: err.message,
            };
        }

        // Elysia schema validation failure
        if (code === "VALIDATION") {
            set.status = 400;
            return {
                success: false,
                code: "VALIDATION_ERROR",
                message: "Validation failed",
                errors: err?.all ?? [],
            };
        }

        // Unknown route
        if (code === "NOT_FOUND") {
            set.status = 404;
            return { success: false, code: "NOT_FOUND", message: "Route not found" };
        }

        // Anything else is unexpected — log full details server-side only
        logger.error(`Unhandled error [${code}]: ${err?.message}`, error);
        set.status = 500;
        return {
            success: false,
            code: "INTERNAL_ERROR",
            message: isProd
                ? "An unexpected error occurred. Please try again."
                : (err?.message ?? "Internal Server Error"),
            ...(!isProd && { stack: err?.stack }),
        };
    })

    // ─── Bootstrap ────────────────────────────────────────────────────────────
    .listen(env.PORT, async () => {
        logger.info(`🚀 Starting ${env.APP_NAME}...`);

        await connectDB();
        await connectRedis();

        startRiderCleanupJob(60_000);
        startTripTimeoutJob(120_000);

        logger.info(`✅ Server running on http://localhost:${env.PORT}`);
        if (!isProd) {
            logger.info(`📖 Swagger UI: http://localhost:${env.PORT}/swagger`);
        }
        logger.info(`🔌 WebSockets: ws://localhost:${env.PORT}/ws`);
    });

// ─── Graceful shutdown (SIGINT = Ctrl+C, SIGTERM = Docker/Railway/K8s) ────────
async function shutdown(signal: string) {
    logger.info(`\n🛑 ${signal} received — shutting down gracefully...`);
    await app.stop();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

export type App = typeof app;
