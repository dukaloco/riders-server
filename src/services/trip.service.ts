import mongoose from "mongoose";
import { Trip } from "../models/Trip";
import { User } from "../models/User";
import { redis, REDIS_KEYS, TTL } from "../config/redis";
import { PricingService } from "./pricing.service";
import { MatchingService } from "./matching.service";
import type { IAddress, IParcel } from "../models/Trip";
import type { TripStatus } from "../types";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../utils/errors";

export const TripService = {

    // Get a price quote before creating a trip.
    getQuote: async (input: {
        pickupLat: number;
        pickupLng: number;
        dropoffLat: number;
        dropoffLng: number;
    }) => {
        const quote = PricingService.calculateQuote(
            input.pickupLat,
            input.pickupLng,
            input.dropoffLat,
            input.dropoffLng
        );
        const riders = await MatchingService.findNearbyRiders(input.pickupLat, input.pickupLng, 10);
        return { ...quote, availableRiders: riders.length };
    },


    //Create a new trip (from customer side).

    createTrip: async (input: {
        customerId: string;
        pickup: IAddress;
        dropoff: IAddress;
        parcel: IParcel;
    }) => {
        const quote = PricingService.calculateQuote(
            input.pickup.latitude,
            input.pickup.longitude,
            input.dropoff.latitude,
            input.dropoff.longitude
        );

        const trip = new Trip({
            customerId: new mongoose.Types.ObjectId(input.customerId),
            pickup: input.pickup,
            dropoff: input.dropoff,
            parcel: input.parcel,
            ...quote,
            status: "pending",
            statusHistory: [{ status: "pending", timestamp: new Date() }],
        });

        await trip.save();
        return trip;
    },


    // Rider accepts a trip.

    acceptTrip: async (tripId: string, riderId: string) => {
        const lockKey = REDIS_KEYS.tripLock(tripId);
        const acquired = await redis.set(lockKey, riderId, "EX", TTL.TRIP_LOCK, "NX");
        if (!acquired) throw new ConflictError("Trip is already being accepted by another rider.");

        const trip = await Trip.findById(tripId);
        if (!trip) throw new NotFoundError("Trip not found.");
        if (trip.status !== "pending") throw new ConflictError("Trip is no longer available.");

        trip.riderId = new mongoose.Types.ObjectId(riderId);
        trip.status = "accepted";
        trip.acceptedAt = new Date();
        trip.statusHistory.push({ status: "accepted", timestamp: new Date() });
        await trip.save();

        await User.findByIdAndUpdate(riderId, {
            "riderProfile.currentStatus": "on_trip",
        });
        await redis.set(REDIS_KEYS.riderStatus(riderId), "on_trip");
        await redis.srem(REDIS_KEYS.onlineRiders(), riderId);

        return trip;
    },


    // Rider rejects/cancels a trip.

    rejectTrip: async (tripId: string, riderId: string, reason?: string) => {
        const trip = await Trip.findById(tripId);
        if (!trip) throw new NotFoundError("Trip not found.");

        if (trip.riderId?.toString() === riderId && trip.status === "accepted") {
            trip.riderId = undefined;
            trip.status = "pending";
            trip.statusHistory.push({ status: "pending", timestamp: new Date(), note: `Reassigned: ${reason ?? "rider cancelled"}` });
            await trip.save();

            await User.findByIdAndUpdate(riderId, {
                "riderProfile.currentStatus": "online",
            });
            await redis.sadd(REDIS_KEYS.onlineRiders(), riderId);
            return trip;
        }

        throw new ForbiddenError("Cannot reject this trip.");
    },


    // Update trip status.

    updateStatus: async (
        tripId: string,
        riderId: string,
        status: TripStatus,
        location?: { latitude: number; longitude: number }
    ) => {
        const trip = await Trip.findOne({ _id: tripId, riderId });
        if (!trip) throw new NotFoundError("Trip not found or you are not assigned to it.");

        const validTransitions: Record<string, TripStatus[]> = {
            accepted: ["picked_up"],
            picked_up: ["in_transit"],
            in_transit: ["delivered"],
        };

        const allowed = validTransitions[trip.status] ?? [];
        if (!allowed.includes(status)) {
            throw new BadRequestError(`Cannot transition from "${trip.status}" to "${status}".`);
        }

        trip.status = status;
        trip.statusHistory.push({ status, timestamp: new Date(), location });

        if (status === "picked_up") trip.pickedUpAt = new Date();
        if (status === "delivered") {
            trip.deliveredAt = new Date();
            await User.findByIdAndUpdate(riderId, {
                "riderProfile.currentStatus": "online",
                $inc: { "riderProfile.totalTrips": 1, "riderProfile.totalEarnings": trip.totalFare },
            });
            await redis.sadd(REDIS_KEYS.onlineRiders(), riderId);
            await redis.set(REDIS_KEYS.riderStatus(riderId), "online");
        }

        await trip.save();
        return trip;
    },


    // Upload proof of delivery.

    uploadProofOfDelivery: async (
        tripId: string,
        riderId: string,
        data: { photoUrl: string; recipientName?: string }
    ) => {
        const trip = await Trip.findOneAndUpdate(
            { _id: tripId, riderId, status: "delivered" },
            {
                proofOfDelivery: {
                    photoUrl: data.photoUrl,
                    recipientName: data.recipientName,
                    uploadedAt: new Date(),
                },
            },
            { new: true }
        );
        if (!trip) throw new NotFoundError("Trip not found or not yet delivered.");
        return trip;
    },


    //Cancel a trip.

    cancelTrip: async (
        tripId: string,
        cancelledBy: "customer" | "rider" | "system",
        reason?: string,
        userId?: string
    ) => {
        const filter: Record<string, unknown> = { _id: tripId };
        if (cancelledBy === "customer") filter.customerId = userId;
        if (cancelledBy === "rider") filter.riderId = userId;

        const trip = await Trip.findOne(filter);
        if (!trip) throw new NotFoundError("Trip not found or you are not authorised to cancel it.");

        const cancellable: TripStatus[] = ["pending", "accepted"];
        if (!cancellable.includes(trip.status)) {
            throw new BadRequestError(`Trip cannot be cancelled at this stage (status: ${trip.status}).`);
        }

        trip.status = "cancelled";
        trip.cancelledBy = cancelledBy;
        trip.cancellationReason = reason;
        trip.cancelledAt = new Date();
        trip.statusHistory.push({ status: "cancelled", timestamp: new Date() });
        await trip.save();

        if (trip.riderId) {
            await User.findByIdAndUpdate(trip.riderId, {
                "riderProfile.currentStatus": "online",
            });
            await redis.sadd(REDIS_KEYS.onlineRiders(), trip.riderId.toString());
        }

        return trip;
    },


    // Rate a trip.
    rateTrip: async (
        tripId: string,
        ratedBy: "customer" | "rider",
        score: number,
        comment?: string
    ) => {
        const trip = await Trip.findById(tripId);
        if (!trip) throw new NotFoundError("Trip not found.");
        if (trip.status !== "delivered") throw new BadRequestError("Trip has not been delivered yet.");

        if (ratedBy === "customer") {
            if (trip.customerRating) throw new ConflictError("You have already rated this trip.");
            trip.customerRating = { score, comment, ratedAt: new Date() };

            const rider = await User.findById(trip.riderId);
            if (rider?.riderProfile) {
                const total = rider.riderProfile.totalRatings + 1;
                const newRating =
                    (rider.riderProfile.rating * rider.riderProfile.totalRatings + score) / total;
                await User.findByIdAndUpdate(trip.riderId, {
                    "riderProfile.rating": Math.round(newRating * 10) / 10,
                    "riderProfile.totalRatings": total,
                });
            }
        } else {
            if (trip.riderRating) throw new ConflictError("You have already rated this trip.");
            trip.riderRating = { score, comment, ratedAt: new Date() };
        }

        await trip.save();
        return trip;
    },


    // Get trip history for a rider.

    getRiderTrips: async (riderId: string, status?: TripStatus, page = 1, limit = 20) => {
        const skip = (page - 1) * limit;
        const filter: Record<string, unknown> = { riderId };
        if (status) filter.status = status;

        const [trips, total] = await Promise.all([
            Trip.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .populate("customerId", "name phone avatar"),
            Trip.countDocuments(filter),
        ]);

        return { trips, total, page, limit, pages: Math.ceil(total / limit) };
    },


    // Get earnings summary for a rider.

    getRiderDashboard: async (riderId: string) => {
        const riderObjectId = new mongoose.Types.ObjectId(riderId);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [user, todayStats, activeDeliveries] = await Promise.all([
            User.findById(riderId)
                .select("riderProfile.currentStatus riderProfile.rating riderProfile.totalTrips"),

            Trip.aggregate([
                {
                    $match: {
                        riderId: riderObjectId,
                        acceptedAt: { $gte: todayStart },
                    },
                },
                {
                    $group: {
                        _id: null,
                        rides:     { $sum: 1 },
                        completed: { $sum: { $cond: [{ $eq: ["$status", "delivered"] },  1, 0] } },
                        cancelled: { $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] } },
                        revenue:   { $sum: { $cond: [{ $eq: ["$status", "delivered"] }, "$totalFare", 0] } },
                    },
                },
            ]),

            Trip.find({
                riderId: riderObjectId,
                status: { $in: ["accepted", "in_transit"] },
            })
                .populate("customerId", "firstName lastName phone")
                .sort({ updatedAt: -1 })
                .lean(),
        ]);

        const stats = todayStats[0] ?? { rides: 0, completed: 0, cancelled: 0, revenue: 0 };

        return {
            status:      user?.riderProfile?.currentStatus ?? "offline",
            rating:      user?.riderProfile?.rating        ?? 0,
            totalTrips:  user?.riderProfile?.totalTrips    ?? 0,
            today: {
                rides:     stats.rides,
                completed: stats.completed,
                cancelled: stats.cancelled,
                revenue:   stats.revenue,
            },
            activeDeliveries,
        };
    },

    getRiderEarnings: async (riderId: string) => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [overall, todayResult, thisWeek] = await Promise.all([
            Trip.aggregate([
                { $match: { riderId: new mongoose.Types.ObjectId(riderId), status: "delivered" } },
                { $group: { _id: null, total: { $sum: "$totalFare" }, count: { $sum: 1 } } },
            ]),
            Trip.aggregate([
                {
                    $match: {
                        riderId: new mongoose.Types.ObjectId(riderId),
                        status: "delivered",
                        deliveredAt: { $gte: today },
                    },
                },
                { $group: { _id: null, total: { $sum: "$totalFare" }, count: { $sum: 1 } } },
            ]),
            Trip.aggregate([
                {
                    $match: {
                        riderId: new mongoose.Types.ObjectId(riderId),
                        status: "delivered",
                        deliveredAt: { $gte: new Date(Date.now() - 7 * 86400 * 1000) },
                    },
                },
                { $group: { _id: null, total: { $sum: "$totalFare" }, count: { $sum: 1 } } },
            ]),
        ]);

        return {
            overall: {
                total: overall[0]?.total ?? 0,
                trips: overall[0]?.count ?? 0,
            },
            today: {
                total: todayResult[0]?.total ?? 0,
                trips: todayResult[0]?.count ?? 0,
            },
            thisWeek: {
                total: thisWeek[0]?.total ?? 0,
                trips: thisWeek[0]?.count ?? 0,
            },
        };
    },
};
