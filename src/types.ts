export type TripStatus =
    | "pending"
    | "accepted"
    | "picked_up"
    | "in_transit"
    | "delivered"
    | "cancelled"
    | "failed";

export type RiderStatus = "offline" | "online" | "on_trip";

export type VehicleType = "motorcycle";

export interface RiderLocation {
    riderId: string;
    latitude: number;
    longitude: number;
    heading?: number;
    speed?: number;
    timestamp: number;
}
