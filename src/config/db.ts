import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "../utils/logger";

let isConnected = false;

/**
 * Connects to MongoDB with enhanced reliability and logging.
 */
export const connectDB = async (): Promise<void> => {
    if (isConnected) return;

    try {
        await mongoose.connect(env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
        });

        isConnected = true;
        logger.info("✅ MongoDB connected successfully");

        mongoose.connection.on("disconnected", () => {
            isConnected = false;
            logger.warn("⚠️  MongoDB disconnected");
        });

        mongoose.connection.on("error", (err) => {
            logger.error("❌ MongoDB error:", err);
        });
    } catch (error) {
        logger.error("❌ MongoDB connection failed:", error);
        process.exit(1);
    }
};

/**
 * Disconnects from MongoDB gracefully.
 */
export const disconnectDB = async (): Promise<void> => {
    if (!isConnected) return;
    await mongoose.disconnect();
    isConnected = false;
    logger.info("MongoDB disconnected gracefully");
};
