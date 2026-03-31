import { redis, REDIS_KEYS } from "../config/redis";
import { User } from "../models/User";
import { haversineDistanceKm } from "../utils/distance";

export interface NearbyRider {
    riderId: string;
    distanceKm: number;
    latitude: number;
    longitude: number;
}

export const MatchingService = {

    findNearbyRiders: async (
        pickupLat: number,
        pickupLng: number,
        radiusKm = 5
    ): Promise<NearbyRider[]> => {
        const riderIds = await redis.smembers(REDIS_KEYS.onlineRiders());
        if (!riderIds.length) return [];

        const nearby: NearbyRider[] = [];

        await Promise.all(
            riderIds.map(async (riderId) => {
                const raw = await redis.get(REDIS_KEYS.riderLocation(riderId));
                if (!raw) return;

                const loc = JSON.parse(raw) as { latitude: number; longitude: number };
                const distanceKm = haversineDistanceKm(
                    pickupLat,
                    pickupLng,
                    loc.latitude,
                    loc.longitude
                );

                if (distanceKm <= radiusKm) {
                    nearby.push({ riderId, distanceKm, latitude: loc.latitude, longitude: loc.longitude });
                }
            })
        );

        // Filter to only approved online riders
        const users = await User.find(
            {
                _id: { $in: nearby.map((r) => r.riderId) },
                "riderProfile.currentStatus": "online",
                "riderProfile.isApproved": true,
            },
            { _id: 1 }
        );
        const validIds = new Set(users.map((u) => u._id.toString()));

        return nearby
            .filter((r) => validIds.has(r.riderId))
            .sort((a, b) => a.distanceKm - b.distanceKm);
    },


    // Mark a rider as online in Redis and add to the online set.

    setRiderOnline: async (riderId: string, latitude: number, longitude: number): Promise<void> => {
        const locationData = JSON.stringify({ latitude, longitude, updatedAt: Date.now() });
        await Promise.all([
            redis.sadd(REDIS_KEYS.onlineRiders(), riderId),
            redis.set(REDIS_KEYS.riderLocation(riderId), locationData),
            redis.set(REDIS_KEYS.riderStatus(riderId), "online"),
        ]);
        await User.findByIdAndUpdate(riderId, {
            "riderProfile.currentStatus": "online",
            "riderProfile.lastLocation": {
                type: "Point",
                coordinates: [longitude, latitude],
                updatedAt: new Date(),
            },
        });
    },


    // Mark a rider as offline and remove from online set.

    setRiderOffline: async (riderId: string): Promise<void> => {
        await Promise.all([
            redis.srem(REDIS_KEYS.onlineRiders(), riderId),
            redis.del(REDIS_KEYS.riderLocation(riderId)),
            redis.set(REDIS_KEYS.riderStatus(riderId), "offline"),
        ]);
        await User.findByIdAndUpdate(riderId, {
            "riderProfile.currentStatus": "offline",
        });
    },
};
