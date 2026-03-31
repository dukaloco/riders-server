import { Elysia, t } from "elysia";
import { User } from "../models/User";
import { MatchingService } from "../services/matching.service";
import { TripService } from "../services/trip.service";
import { parsePagination } from "../utils/helpers";
import { authPlugin } from "../middleware/auth.middleware";

export const riderRoutes = new Elysia({ prefix: "/api/riders" })
    .use(authPlugin)
    .guard({ isAuth: ["rider", "admin"] })

    // ─── Availability ─────────────────────────────────────────────────────────

    .post("/go-online", async ({ user, body }) => {
        await MatchingService.setRiderOnline(user!.id, body.latitude, body.longitude);
        return { success: true, message: "You are now online", data: { status: "online" } };
    }, {
        body: t.Object({
            latitude: t.Number(),
            longitude: t.Number(),
        }),
    })

    .post("/go-offline", async ({ user }) => {
        await MatchingService.setRiderOffline(user!.id);
        return { success: true, message: "You are now offline", data: { status: "offline" } };
    })

    // ─── Stats & history ──────────────────────────────────────────────────────

    .get("/status", async ({ user }) => {
        const dbUser = await User.findById(user!.id)
            .select("riderProfile.currentStatus riderProfile.rating riderProfile.totalTrips");
        return {
            success: true,
            message: "Status fetched",
            data: {
                status: dbUser?.riderProfile?.currentStatus ?? "offline",
                rating: dbUser?.riderProfile?.rating ?? 0,
                totalTrips: dbUser?.riderProfile?.totalTrips ?? 0,
            },
        };
    })

    .get("/trips", async ({ user, query }) => {
        const { page, limit } = parsePagination(query as any);
        const result = await TripService.getRiderTrips(user!.id, query.status as any, page, limit);
        return { success: true, message: "Trips fetched", data: result };
    }, {
        query: t.Object({
            page: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            status: t.Optional(t.String()),
        }),
    })

    .get("/earnings", async ({ user }) => {
        const earnings = await TripService.getRiderEarnings(user!.id);
        return { success: true, message: "Earnings fetched", data: earnings };
    });
