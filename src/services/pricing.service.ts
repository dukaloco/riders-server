import { env } from "../config/env";

export interface PriceQuote {
    distanceKm:       number;
    estimatedMinutes: number;
    baseFare:         number;
    distanceFare:     number;
    totalFare:        number;
    currency:         string;
}

export const PricingService = {
    /**
     * Calculate a fare from a pre-computed road distance and duration.
     * Callers should obtain distanceKm/durationMinutes from getRoadDistance()
     * (Directions API) rather than Haversine so the fare reflects actual roads.
     */
    calculateQuote: (distanceKm: number, durationMinutes: number): PriceQuote => {
        const baseFare      = env.BASE_FARE;
        const distanceFare  = Math.ceil(distanceKm * env.PRICE_PER_KM);
        const rawTotal      = baseFare + distanceFare;
        const totalFare     = Math.max(rawTotal, env.MINIMUM_FARE);

        return {
            distanceKm:       Math.round(distanceKm * 100) / 100,
            estimatedMinutes: durationMinutes,
            baseFare,
            distanceFare,
            totalFare,
            currency: "KES",
        };
    },
};
