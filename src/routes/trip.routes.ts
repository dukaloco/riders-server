import { Elysia, t } from "elysia";
import { TripService } from "../services/trip.service";
import { parsePagination, isValidObjectId } from "../utils/helpers";
import { authPlugin } from "../middleware/auth.middleware";
import { Trip } from "../models/Trip";
import { StorageService } from "../services/storage.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../utils/errors";
import { wsBroadcast } from "../sockets/serverRef";
import { redis, REDIS_KEYS, TTL } from "../config/redis";

export const tripRoutes = new Elysia({ prefix: "/api/trips" })
    .use(authPlugin)

    // ─── Authenticated routes ─────────────────────────────────────────────────

    .guard({ isAuth: true }, (app) => app

        .post("/quote", async ({ body }) => {
            const quote = await TripService.getQuote(body);
            return { success: true, message: "Quote calculated", data: quote };
        }, {
            body: t.Object({
                pickupLat:  t.Number(),
                pickupLng:  t.Number(),
                dropoffLat: t.Number(),
                dropoffLng: t.Number(),
            }),
        })

        .get("/", async ({ user, query }) => {
            const { page, limit, skip } = parsePagination(query as any);
            const filter: Record<string, unknown> = {};
            const requestedRole = query.role;
            console.log(`[trips] user=${user!.id} roles=${user!.roles} requestedRole=${requestedRole}`);
            if (requestedRole === "customer" && user!.roles.includes("customer")) {
                filter.customerId = user!.id;
                console.log(`[trips] Filter set: customerId=${user!.id}`);
            } else if (requestedRole === "rider" && user!.roles.includes("rider")) {
                filter.riderId = user!.id;
                console.log(`[trips] Filter set: riderId=${user!.id}`);
            } else if (!user!.roles.includes("admin")) {
                // fallback when no role param: rider takes precedence
                if (user!.roles.includes("rider")) {
                    filter.riderId = user!.id;
                    console.log(`[trips] Fallback filter: riderId=${user!.id}`);
                }
                else if (user!.roles.includes("customer")) {
                    filter.customerId = user!.id;
                    console.log(`[trips] Fallback filter: customerId=${user!.id}`);
                }
            }
            console.log(`[trips] Final filter:`, JSON.stringify(filter));
            // admin with no role param: no filter — sees all trips
            if (query.status) {
                const statuses = query.status.split(',').map(s => s.trim()).filter(Boolean);
                filter.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
            }

            const [trips, total] = await Promise.all([
                Trip.find(filter)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(limit)
                    .populate("riderId", "name phone riderProfile.vehicle riderProfile.rating"),
                Trip.countDocuments(filter),
            ]);

            return {
                success: true,
                message: "Trips fetched",
                data: { trips, total, page, pages: Math.ceil(total / limit) },
            };
        }, {
            query: t.Object({
                page:   t.Optional(t.String()),
                limit:  t.Optional(t.String()),
                role:   t.Optional(t.String()),
                status: t.Optional(t.String()),
                search: t.Optional(t.String()),
            }),
        })

        .get("/:id", async ({ user, params }) => {
            if (!isValidObjectId(params.id)) throw new BadRequestError("Invalid trip ID.");

            const trip = await Trip.findById(params.id)
                .populate("customerId", "firstName lastName phone avatar")
                .populate("riderId", "firstName lastName phone avatar riderProfile.rating riderProfile.vehicle");

            if (!trip) throw new NotFoundError("Trip not found.");

            // const isOwner =
            //     trip.customerId?.toString() === user!.id ||
            //     trip.riderId?.toString() === user!.id ||
            //     user!.role === "admin";

            // if (!isOwner) throw new ForbiddenError("Access denied.");

            return { success: true, message: "Trip fetched", data: trip };
        })

        .post("/:id/cancel", async ({ user, params, body }) => {
            const cancelledBy = user!.roles.includes("rider") ? "rider" : "customer";
            const trip = await TripService.cancelTrip(params.id, cancelledBy, body.reason, user!.id);
            return { success: true, message: "Trip cancelled", data: trip };
        }, {
            body: t.Object({ reason: t.Optional(t.String({ maxLength: 300 })) }),
        })

        .post("/:id/rate", async ({ user, params, body }) => {
            const ratedBy = user!.roles.includes("rider") ? "rider" : "customer";
            const trip = await TripService.rateTrip(params.id, ratedBy, body.score, body.comment);
            return { success: true, message: "Rating submitted", data: trip };
        }, {
            body: t.Object({
                score: t.Number({ minimum: 1, maximum: 5 }),
                comment: t.Optional(t.String({ maxLength: 300 })),
            }),
        })

        // ─── Customer only ────────────────────────────────────────────────────

        .post("/", async ({ user, body, set }) => {
            const { preferredRiderId, ...tripBody } = body;
            const trip = await TripService.createTrip({ customerId: user!.id, ...tripBody });

            // Push a real-time request to the chosen rider.
            // If their WebSocket isn't connected right now, queue it in Redis so it
            // gets delivered the moment they (re)connect — avoids lost notifications.
            if (preferredRiderId) {
                const notification = {
                    type: "trip:request",
                    payload: {
                        tripId:            trip._id.toString(),
                        fare:              trip.totalFare,
                        currency:          trip.currency,
                        parcelDescription: trip.parcel.description,
                        pickup:            trip.pickup,
                        dropoff:           trip.dropoff,
                        distanceKm:        trip.distanceKm,
                        estimatedMinutes:  trip.estimatedMinutes,
                    },
                };

                const delivered = wsBroadcast(`user:${preferredRiderId}`, notification);

                if (delivered === 0) {
                    // Rider not connected — store for delivery on next WS open
                    await redis.set(
                        REDIS_KEYS.riderPendingNotif(preferredRiderId),
                        JSON.stringify(notification),
                        "EX",
                        TTL.RIDER_NOTIF,
                    );
                }
            }

            set.status = 201;
            return { success: true, message: "Trip created successfully", data: trip };
        }, {
            isAuth: ["customer", "admin"],
            body: t.Object({
                quoteId: t.String({ minLength: 1 }),
                preferredRiderId: t.Optional(t.String()),
                pickup: t.Object({
                    address:   t.String({ minLength: 3 }),
                    latitude:  t.Number(),
                    longitude: t.Number(),
                    landmark:  t.Optional(t.String()),
                }),
                dropoff: t.Object({
                    address:   t.String({ minLength: 3 }),
                    latitude:  t.Number(),
                    longitude: t.Number(),
                    landmark:  t.Optional(t.String()),
                }),
                recipient: t.Object({
                    name:  t.String({ minLength: 2, maxLength: 100 }),
                    phone: t.String({ minLength: 7, maxLength: 20 }),
                }),
                parcel: t.Object({
                    description:         t.String({ minLength: 3, maxLength: 200 }),
                    weight:              t.Optional(t.Number()),
                    size:                t.Optional(t.Enum({ small: "small", medium: "medium", large: "large" })),
                    isFragile:           t.Optional(t.Boolean({ default: false })),
                    specialInstructions: t.Optional(t.String({ maxLength: 500 })),
                }),
            }),
        })

        // ─── Rider only ───────────────────────────────────────────────────────

        .post("/:id/accept", async ({ user, params }) => {
            const trip = await TripService.acceptTrip(params.id, user!.id);
            return { success: true, message: "Trip accepted", data: trip };
        }, { isAuth: ["rider"] })

        .post("/:id/reject", async ({ user, params, body }) => {
            const trip = await TripService.rejectTrip(params.id, user!.id, body.reason);
            return { success: true, message: "Trip rejected", data: trip };
        }, {
            isAuth: ["rider"],
            body: t.Object({ reason: t.Optional(t.String({ maxLength: 300 })) }),
        })

        .patch("/:id/status", async ({ user, params, body }) => {
            const location = body.latitude && body.longitude
                ? { latitude: body.latitude, longitude: body.longitude }
                : undefined;
            const trip = await TripService.updateStatus(params.id, user!.id, body.status as any, location);
            return { success: true, message: `Status updated to ${body.status}`, data: trip };
        }, {
            isAuth: ["rider"],
            body: t.Object({
                status: t.Enum({ picked_up: "picked_up", in_transit: "in_transit", delivered: "delivered" }),
                latitude: t.Optional(t.Number()),
                longitude: t.Optional(t.Number()),
            }),
        })

        .post("/:id/proof", async ({ user, params, body }) => {
            if (!body.photo) throw new BadRequestError("Photo is required.");
            const photoUrl = await StorageService.upload(body.photo, `proof-of-delivery/${params.id}`);
            const trip = await TripService.uploadProofOfDelivery(params.id, user!.id, {
                photoUrl,
                recipientName: body.recipientName,
            });
            return { success: true, message: "Proof of delivery uploaded", data: trip };
        }, {
            isAuth: ["rider"],
            body: t.Object({
                photo: t.File({ maxSize: 5 * 1024 * 1024 }),
                recipientName: t.Optional(t.String({ maxLength: 100 })),
            }),
        })
    );
