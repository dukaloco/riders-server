import { Trip } from "../models/Trip";
import { logger } from "../utils/logger";

const PENDING_TIMEOUT_MINUTES = 10; // auto-cancel if no rider accepts within 10 min

/**
 * Runs every 2 minutes.
 * Finds pending trips older than PENDING_TIMEOUT_MINUTES and cancels them.
 */
export const runTripTimeoutJob = async (): Promise<void> => {
    logger.debug("⏱  Running trip timeout job...");

    try {
        const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MINUTES * 60 * 1000);

        const result = await Trip.updateMany(
            {
                status: "pending",
                createdAt: { $lt: cutoff },
            },
            {
                $set: {
                    status: "cancelled",
                    cancelledBy: "system",
                    cancellationReason: "No rider accepted within the timeout window",
                    cancelledAt: new Date(),
                },
                $push: {
                    statusHistory: {
                        status: "cancelled",
                        timestamp: new Date(),
                        note: "Auto-cancelled: no rider available",
                    },
                },
            }
        );

        if (result.modifiedCount > 0) {
            logger.info(`⏱  Trip timeout: auto-cancelled ${result.modifiedCount} pending trip(s)`);
        }
    } catch (err) {
        logger.error("❌ Trip timeout job failed:", err);
    }
};

/**
 * Start the recurring trip timeout job.
 * @param intervalMs Default: 120 000 ms (2 minutes)
 */
export const startTripTimeoutJob = (intervalMs = 120_000): any => {
    logger.info(`🕐 Trip timeout job started (every ${intervalMs / 1000}s)`);
    return setInterval(runTripTimeoutJob, intervalMs);
};
