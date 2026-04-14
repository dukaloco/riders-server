import { Elysia, t } from "elysia";

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

    // ─── KYC applications list ─────────────────────────────────────────────────
    // GET /api/admin/kyc/applications
    //
    // Query params:
    //   status  — all | pending | approved | rejected  (default: all)
    //   search  — partial match on name or phone
    //   page    — 1-based page number (default: 1)
    //   limit   — page size, max 50 (default: 20)

    .get("/kyc/applications", async ({ query }) => {
        const page  = Math.max(1, parseInt(query.page  ?? "1"));
        const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? "20")));
        const skip  = (page - 1) * limit;
        const status = (query.status ?? "all") as "all" | "pending" | "approved" | "rejected";
        const search = (query.search ?? "").trim();

        const now = new Date();

        // Build the status filter
        const statusFilter: Record<string, unknown> = {
            role: "rider",
            "riderProfile.applicationSubmitted": true,
        };
        if (status === "pending")  statusFilter["riderProfile.isApproved"] = false;
        if (status === "approved") statusFilter["riderProfile.isApproved"] = true;
        // "rejected" not yet tracked in the model — returns empty intentionally
        if (status === "rejected") statusFilter["_id"] = { $exists: false };

        // Add name/phone search
        const searchFilter = search
            ? { ...statusFilter, $or: [
                { firstName: { $regex: search, $options: "i" } },
                { lastName:  { $regex: search, $options: "i" } },
                { phone:     { $regex: search, $options: "i" } },
            ] }
            : statusFilter;

        const baseSubmitted = { role: "rider", "riderProfile.applicationSubmitted": true };

        const [applications, total, pendingCount, approvedCount, allCount] = await Promise.all([
            User.find(searchFilter)
                .select("firstName lastName phone riderProfile.documents riderProfile.isApproved updatedAt")
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            User.countDocuments(searchFilter),
            User.countDocuments({ ...baseSubmitted, "riderProfile.isApproved": false }),
            User.countDocuments({ ...baseSubmitted, "riderProfile.isApproved": true }),
            User.countDocuments(baseSubmitted),
        ]);

        const mapped = applications.map((u) => {
            const hoursWaiting = Math.floor(
                (now.getTime() - new Date(u.updatedAt as Date).getTime()) / (1000 * 60 * 60)
            );
            return {
                id:            u._id,
                name:          `${u.firstName} ${u.lastName}`.trim() || "Unknown",
                phone:         u.phone,
                documentCount: u.riderProfile?.documents?.length ?? 0,
                status:        (u.riderProfile?.isApproved ? "approved" : "pending") as "approved" | "pending",
                urgency:       (hoursWaiting > 24 ? "urgent" : hoursWaiting > 4 ? "medium" : null) as "urgent" | "medium" | null,
                submittedAt:   u.updatedAt,
            };
        });

        return {
            success: true,
            message: "KYC applications fetched",
            data: {
                applications: mapped,
                counts: {
                    all:      allCount,
                    pending:  pendingCount,
                    approved: approvedCount,
                    rejected: 0,
                },
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit),
                },
            },
        };
    }, {
        query: t.Object({
            status: t.Optional(t.String()),
            search: t.Optional(t.String()),
            page:   t.Optional(t.String()),
            limit:  t.Optional(t.String()),
        }),
    })

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
            recentKycDocs,
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

            // 5 most recently updated submitted applications (any status)
            User.find({
                role: "rider",
                "riderProfile.applicationSubmitted": true,
            })
                .select("firstName lastName phone riderProfile.documents riderProfile.isApproved updatedAt")
                .sort({ updatedAt: -1 })
                .limit(5)
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

        const recentKyc = recentKycDocs.map((u) => ({
            id:            u._id,
            name:          `${u.firstName} ${u.lastName}`.trim() || "Unknown",
            phone:         u.phone,
            documentCount: u.riderProfile?.documents?.length ?? 0,
            status:        (u.riderProfile?.isApproved ? "approved" : "pending") as "approved" | "pending",
            updatedAt:     u.updatedAt,
        }));

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
                    recent:       recentKyc,
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
