import { redis, REDIS_KEYS } from "../config/redis";
import { User } from "../models/User";
import { logger } from "../utils/logger";

/**
 * Runs every 60 seconds.
 * Any rider whose Redis location key has expired (TTL elapsed) but is still
 * marked "online" in the DB gets set to "offline" automatically.
 * This handles riders who lose connectivity without explicitly going offline.
 */
export const runRiderCleanupJob = async (): Promise<void> => {
    logger.debug("🧹 Running rider cleanup job...");

    try {
        const onlineRiderIds = await redis.smembers(REDIS_KEYS.onlineRiders());

        let cleaned = 0;
        await Promise.all(
            onlineRiderIds.map(async (riderId) => {
                const loc = await redis.get(REDIS_KEYS.riderLocation(riderId));
                if (!loc) {
                    // Location TTL expired — rider is stale
                    await Promise.all([
                        redis.srem(REDIS_KEYS.onlineRiders(), riderId),
                        redis.del(REDIS_KEYS.riderStatus(riderId)),
                        User.findByIdAndUpdate(riderId, {
                            "riderProfile.currentStatus": "offline",
                        }),
                    ]);
                    cleaned++;
                    logger.info(`🔴 Auto-offlined stale rider: ${riderId}`);
                }
            })
        );

        if (cleaned > 0) {
            logger.info(`🧹 Rider cleanup: offlined ${cleaned} stale rider(s)`);
        }
    } catch (err) {
        logger.error("❌ Rider cleanup job failed:", err);
    }
};

/**
 * Start the recurring cleanup job.
 * @param intervalMs Default: 60 000 ms (1 minute)
 */
export const startRiderCleanupJob = (intervalMs = 60_000): any => {
    logger.info(`🕐 Rider cleanup job started (every ${intervalMs / 1000}s)`);
    return setInterval(runRiderCleanupJob, intervalMs);
};
