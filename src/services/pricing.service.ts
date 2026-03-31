import { env } from "../config/env";
import { haversineDistanceKm, estimateTravelMinutes } from "../utils/distance";

export interface PriceQuote {
    distanceKm: number;
    estimatedMinutes: number;
    baseFare: number;
    distanceFare: number;
    totalFare: number;
    currency: string;
}

export const PricingService = {
    calculateQuote: (
        pickupLat: number,
        pickupLng: number,
        dropoffLat: number,
        dropoffLng: number
    ): PriceQuote => {
        const distanceKm = haversineDistanceKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
        const estimatedMinutes = estimateTravelMinutes(distanceKm);

        const baseFare = env.BASE_FARE;
        const distanceFare = Math.ceil(distanceKm * env.PRICE_PER_KM);
        const rawTotal = baseFare + distanceFare;
        const totalFare = Math.max(rawTotal, env.MINIMUM_FARE);

        return {
            distanceKm: Math.round(distanceKm * 100) / 100,
            estimatedMinutes,
            baseFare,
            distanceFare,
            totalFare,
            currency: "KES",
        };
    },
};
