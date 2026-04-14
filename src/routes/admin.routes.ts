import { Elysia } from "elysia";

import { authPlugin } from "../middleware/auth.middleware";
import { Trip } from "../models/Trip";
import { User } from "../models/User";

export const adminRoutes = new Elysia({ prefix: "/api/admin" })
    .use(authPlugin)
    .guard({ isAuth: ["admin"] })

    // ─── Dashboard stats ──────────────────────────────────────────────────────
    // GET /api/admin/dashboard/stats
    //
    // Returns:
    //   riders      — total count + new today vs yesterday (trend)
    //   kyc         — pending count + urgent applications (waiting > 24 h) with
    //                 per-application hours-waiting, sorted oldest-first
    //   activeRides — trips currently in progress
    //   revenue     — today vs yesterday totals with trend indicator

    .get("/dashboard/stats", async () => {
        const now = new Date();

        //  Time boundaries
        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);

        const yesterdayStart = new Date(todayStart);
        yesterdayStart.setDate(yesterdayStart.getDate() - 1);

        const yesterdayEnd = new Date(todayStart.getTime() - 1); // 23:59:59.999 yesterday

        // Applications waiting longer than this are "urgent"
        const urgentThreshold = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // Parallel queries
        const [
            totalRiders,
            newRidersToday,
            newRidersYesterday,
            pendingKycCount,
            urgentKycDocs,
            activeRidesCount,
            todayRevenue,
            yesterdayRevenue,
        ] = await Promise.all([
            // Total registered riders
            User.countDocuments({ role: "rider" }),

            // Riders who joined today
            User.countDocuments({
                role: "rider",
                createdAt: { $gte: todayStart },
            }),

            // Riders who joined yesterday
            User.countDocuments({
                role: "rider",
                createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
            }),

            // All pending KYC (submitted, not yet approved)
            User.countDocuments({
                role: "rider",
                "riderProfile.applicationSubmitted": true,
                "riderProfile.isApproved": false,
            }),

            // Urgent KYC: pending AND last updated more than 24 h ago
            // Sorted oldest-first (most overdue at the top), capped at 20
            User.find({
                role: "rider",
                "riderProfile.applicationSubmitted": true,
                "riderProfile.isApproved": false,
                updatedAt: { $lte: urgentThreshold },
            })
                .select("firstName lastName phone updatedAt")
                .sort({ updatedAt: 1 })
                .limit(20)
                .lean(),

            // Active rides: accepted / picked-up / in-transit
            Trip.countDocuments({
                status: { $in: ["accepted", "picked_up", "in_transit"] },
            }),

            // Revenue from trips delivered today
            Trip.aggregate([
                {
                    $match: {
                        status: "delivered",
                        deliveredAt: { $gte: todayStart },
                    },
                },
                { $group: { _id: null, total: { $sum: "$totalFare" } } },
            ]),

            // Revenue from trips delivered yesterday
            Trip.aggregate([
                {
                    $match: {
                        status: "delivered",
                        deliveredAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
                    },
                },
                { $group: { _id: null, total: { $sum: "$totalFare" } } },
            ]),
        ]);

        // ── Derived values ─────────────────────────────────────────────────────
        const todayRevenueAmt     = (todayRevenue[0]?.total     as number) ?? 0;
        const yesterdayRevenueAmt = (yesterdayRevenue[0]?.total as number) ?? 0;

        const riderTrend: "up" | "down" | "same" =
            newRidersToday > newRidersYesterday ? "up"
            : newRidersToday < newRidersYesterday ? "down"
            : "same";

        const riderChangePercent = newRidersYesterday === 0
            ? (newRidersToday > 0 ? 100 : 0)
            : Math.round(((newRidersToday - newRidersYesterday) / newRidersYesterday) * 100);

        const revenueTrend: "up" | "down" | "same" =
            todayRevenueAmt > yesterdayRevenueAmt ? "up"
            : todayRevenueAmt < yesterdayRevenueAmt ? "down"
            : "same";

        const revenueChangePercent = yesterdayRevenueAmt === 0
            ? (todayRevenueAmt > 0 ? 100 : 0)
            : Math.round(((todayRevenueAmt - yesterdayRevenueAmt) / yesterdayRevenueAmt) * 100);

        const urgentApplications = urgentKycDocs.map((u) => ({
            id:           u._id,
            name:         `${u.firstName} ${u.lastName}`.trim() || "Unknown",
            phone:        u.phone,
            hoursWaiting: Math.floor(
                (now.getTime() - new Date(u.updatedAt as Date).getTime()) / (1000 * 60 * 60)
            ),
        }));

        return {
            success: true,
            message: "Dashboard stats fetched",
            data: {
                riders: {
                    total:         totalRiders,
                    newToday:      newRidersToday,
                    newYesterday:  newRidersYesterday,
                    trend:         riderTrend,
                    changePercent: riderChangePercent,
                },
                kyc: {
                    pending:      pendingKycCount,
                    urgentCount:  urgentApplications.length,
                    urgent:       urgentApplications,
                },
                activeRides: {
                    count: activeRidesCount,
                },
                revenue: {
                    today:         todayRevenueAmt,
                    yesterday:     yesterdayRevenueAmt,
                    trend:         revenueTrend,
                    changePercent: revenueChangePercent,
                    currency:      "KES",
                },
            },
        };
    });
