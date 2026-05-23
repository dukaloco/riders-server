import { env } from "../config/env";
import { haversineDistanceKm, estimateTravelMinutes } from "./distance";
import { logger } from "./logger";

export interface RoadDistance {
    distanceKm:      number;
    durationMinutes: number;
    /** true when the result came from the Directions API, false when Haversine was used */
    isRoadBased:     boolean;
}

/**
 * Returns the driving road distance and estimated duration between two points.
 *
 * Uses the Google Maps Directions API when GOOGLE_MAPS_API_KEY is set;
 * otherwise falls back to straight-line Haversine distance so the server
 * keeps working without a key (e.g. in local dev).
 */
export async function getRoadDistance(
    pickupLat:  number,
    pickupLng:  number,
    dropoffLat: number,
    dropoffLng: number,
): Promise<RoadDistance> {
    const key = env.GOOGLE_MAPS_API_KEY;

    if (!key) {
        logger.warn("[googleMaps] GOOGLE_MAPS_API_KEY not set — using Haversine fallback");
        return haversineFallback(pickupLat, pickupLng, dropoffLat, dropoffLng);
    }

    try {
        const url =
            `https://maps.googleapis.com/maps/api/directions/json` +
            `?origin=${pickupLat},${pickupLng}` +
            `&destination=${dropoffLat},${dropoffLng}` +
            `&mode=driving` +
            `&key=${key}`;

        const res  = await fetch(url);
        const data = await res.json() as any;

        if (data.status !== "OK" || !data.routes?.[0]?.legs?.[0]) {
            logger.warn(`[googleMaps] Directions API returned status=${data.status} — using Haversine fallback`);
            return haversineFallback(pickupLat, pickupLng, dropoffLat, dropoffLng);
        }

        const leg = data.routes[0].legs[0];
        return {
            distanceKm:      leg.distance.value / 1000,
            durationMinutes: Math.ceil(leg.duration.value / 60),
            isRoadBased:     true,
        };
    } catch (err) {
        logger.error("[googleMaps] Directions API fetch failed — using Haversine fallback", err);
        return haversineFallback(pickupLat, pickupLng, dropoffLat, dropoffLng);
    }
}

function haversineFallback(
    pickupLat:  number,
    pickupLng:  number,
    dropoffLat: number,
    dropoffLng: number,
): RoadDistance {
    const distanceKm = haversineDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
    return {
        distanceKm,
        durationMinutes: estimateTravelMinutes(distanceKm),
        isRoadBased:     false,
    };
}
