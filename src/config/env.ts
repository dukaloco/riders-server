import { z } from "zod";

const envSchema = z.object({
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

    MONGO_URI: z.string().min(1, "MONGO_URI is required"),

    REDIS_HOST: z.string().default("localhost"),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_URL: z.string().optional(),

    JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
    JWT_EXPIRES_IN: z.string().default("7d"),

    APP_NAME: z.string().default("RidersApp"),
    BASE_URL: z.string().default("http://localhost:3000"),
    // Comma-separated list of allowed CORS origins, e.g. https://app.example.com,https://admin.example.com
    CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:8081"),

    // Cloudflare R2 (S3-compatible)
    STORAGE_BUCKET: z.string().min(1, "STORAGE_BUCKET is required"),
    STORAGE_ENDPOINT: z.string().min(1, "STORAGE_ENDPOINT is required"),
    STORAGE_ACCESS_KEY: z.string().min(1, "STORAGE_ACCESS_KEY is required"),
    STORAGE_SECRET_KEY: z.string().min(1, "STORAGE_SECRET_KEY is required"),
    STORAGE_PUBLIC_URL: z.string().min(1, "STORAGE_PUBLIC_URL is required"),

    BASE_FARE: z.coerce.number().default(50),
    PRICE_PER_KM: z.coerce.number().default(20),
    MINIMUM_FARE: z.coerce.number().default(100),

    // TextSMS Kenya (textsms.co.ke)
    TEXTSMS_API_KEY: z.string().min(1, "TEXTSMS_API_KEY is required"),
    TEXTSMS_PARTNER_ID: z.string().min(1, "TEXTSMS_PARTNER_ID is required"),
    TEXTSMS_SHORTCODE: z.string().min(1, "TEXTSMS_SHORTCODE is required"),
    // Set to "true" to send real SMS even in development (for testing)
    TEXTSMS_FORCE: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
}

export const env = parsed.data;
