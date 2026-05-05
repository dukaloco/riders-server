import { Elysia, t } from "elysia";
import { TripService } from "../services/trip.service";
import { parsePagination, isValidObjectId } from "../utils/helpers";
import { authPlugin } from "../middleware/auth.middleware";
import { Trip } from "../models/Trip";
import { StorageService } from "../services/storage.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../utils/errors";

export const tripRoutes = new Elysia({ prefix: "/api/trips" })
    .use(authPlugin)

    // ─── Public: price quote ──────────────────────────────────────────────────

    .post("/quote", async ({ body }) => {
        const quote = await TripService.getQuote(body);
        return { success: true, message: "Quote calculated", data: quote };
    }, {
        body: t.Object({
            pickupLat: t.Number(),
            pickupLng: t.Number(),
            dropoffLat: t.Number(),
            dropoffLng: t.Number(),
        }),
    })

    // ─── Authenticated routes ─────────────────────────────────────────────────

    .guard({ isAuth: true }, (app) => app

        .get("/", async ({ user, query }) => {
            const { page, limit, skip } = parsePagination(query as any);
            const filter: Record<string, unknown> = {};
            if (user!.roles.includes("rider")) filter.riderId = user!.id;
            else if (user!.roles.includes("customer")) filter.customerId = user!.id;
            // admin: no filter — sees all trips
            if (query.status) filter.status = query.status; // enum-validated by TypeBox below

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
                page: t.Optional(t.String()),
                limit: t.Optional(t.String()),
                status: t.Optional(t.Union([
                    t.Literal("pending"),
                    t.Literal("accepted"),
                    t.Literal("picked_up"),
                    t.Literal("in_transit"),
                    t.Literal("delivered"),
                    t.Literal("cancelled"),
                    t.Literal("rejected"),
                ])),
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
            const trip = await TripService.createTrip({ customerId: user!.id, ...body });
            set.status = 201;
            return { success: true, message: "Trip created successfully", data: trip };
        }, {
            isAuth: ["customer", "admin"],
            body: t.Object({
                pickup: t.Object({
                    address: t.String({ minLength: 3 }),
                    latitude: t.Number(),
                    longitude: t.Number(),
                    landmark: t.Optional(t.String()),
                }),
                dropoff: t.Object({
                    address: t.String({ minLength: 3 }),
                    latitude: t.Number(),
                    longitude: t.Number(),
                    landmark: t.Optional(t.String()),
                }),
                parcel: t.Object({
                    description: t.String({ minLength: 3, maxLength: 200 }),
                    weight: t.Optional(t.Number()),
                    size: t.Optional(t.Enum({ small: "small", medium: "medium", large: "large" })),
                    isFragile: t.Optional(t.Boolean({ default: false })),
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
