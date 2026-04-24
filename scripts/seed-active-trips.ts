/**
 * Seed fake active trips for a rider to simulate the home screen dashboard.
 *
 * Usage:
 *   bun scripts/seed-active-trips.ts --riderId <ObjectId>
 *   bun scripts/seed-active-trips.ts --riderId <ObjectId> --customerId <ObjectId>
 *   bun scripts/seed-active-trips.ts --riderId <ObjectId> --clear   # remove seeded trips only
 *
 * Requires MONGO_URI in .env.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { Trip } from "../src/models/Trip";
import { User } from "../src/models/User";

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    if (i !== -1) return process.argv[i + 1] ?? "true";
    return undefined;
}

const SEED_TAG = "SEEDED_ACTIVE";

const TRIPS = [
    {
        status: "accepted" as const,
        pickup:  { address: "Westlands Mall, Nairobi",     latitude: -1.2676, longitude: 36.8079 },
        dropoff: { address: "Kilimani Apartments, Nairobi", latitude: -1.2921, longitude: 36.7826 },
        parcel:  { description: "Electronics package", weight: 2, size: "medium" as const },
        distanceKm: 4.8,
        estimatedMinutes: 14,
        baseFare: 80,
        distanceFare: 96,
        totalFare: 176,
    },
    {
        status: "in_transit" as const,
        pickup:  { address: "CBD Kencom Stage, Nairobi",  latitude: -1.2833, longitude: 36.8219 },
        dropoff: { address: "Lavington Green, Nairobi",   latitude: -1.2777, longitude: 36.7714 },
        parcel:  { description: "Documents envelope", weight: 0.3, size: "small" as const },
        distanceKm: 6.2,
        estimatedMinutes: 20,
        baseFare: 80,
        distanceFare: 124,
        totalFare: 204,
    },
    {
        status: "accepted" as const,
        pickup:  { address: "Sarit Centre, Westlands",   latitude: -1.2604, longitude: 36.8026 },
        dropoff: { address: "South B Shopping Centre",   latitude: -1.3121, longitude: 36.8343 },
        parcel:  { description: "Grocery order", weight: 4, size: "large" as const },
        distanceKm: 7.1,
        estimatedMinutes: 22,
        baseFare: 80,
        distanceFare: 142,
        totalFare: 222,
    },
];

async function main() {
    const riderId   = arg("riderId");
    const customerId = arg("customerId");
    const clear     = arg("clear") === "true";

    const uri = process.env.MONGO_URI;
    if (!uri) { console.error("MONGO_URI not set."); process.exit(1); }
    if (!riderId) {
        console.error("Usage: bun scripts/seed-active-trips.ts --riderId <ObjectId> [--customerId <ObjectId>] [--clear]");
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log("✅ MongoDB connected");

    if (clear) {
        const res = await Trip.deleteMany({
            riderId: new mongoose.Types.ObjectId(riderId),
            "parcel.specialInstructions": SEED_TAG,
        });
        console.log(`🗑  Removed ${res.deletedCount} seeded trip(s).`);
        await mongoose.disconnect();
        return;
    }

    // Resolve customerId — use provided, or fall back to riderId itself
    const resolvedCustomerId = customerId
        ? new mongoose.Types.ObjectId(customerId)
        : new mongoose.Types.ObjectId(riderId);

    // Confirm rider exists
    const rider = await User.findById(riderId).select("firstName lastName");
    if (!rider) { console.error(`Rider ${riderId} not found.`); process.exit(1); }

    const now = new Date();
    const docs = TRIPS.map((t) => ({
        ...t,
        riderId:   new mongoose.Types.ObjectId(riderId),
        customerId: resolvedCustomerId,
        currency: "KES",
        acceptedAt: new Date(now.getTime() - Math.random() * 30 * 60 * 1000), // up to 30 min ago
        ...(t.status === "in_transit" ? { pickedUpAt: new Date(now.getTime() - Math.random() * 10 * 60 * 1000) } : {}),
        parcel: { ...t.parcel, specialInstructions: SEED_TAG },
        statusHistory: [
            { status: "pending",  timestamp: new Date(now.getTime() - 40 * 60 * 1000) },
            { status: "accepted", timestamp: new Date(now.getTime() - 30 * 60 * 1000) },
            ...(t.status === "in_transit"
                ? [{ status: "in_transit", timestamp: new Date(now.getTime() - 10 * 60 * 1000) }]
                : []),
        ],
    }));

    const created = await Trip.insertMany(docs);
    console.log(`\n🎉 Seeded ${created.length} active trip(s) for rider: ${rider.firstName} ${rider.lastName} (${riderId})\n`);
    created.forEach((t) => console.log(`  • [${t.status}] ${t._id}  →  ${t.pickup.address}  ➜  ${t.dropoff.address}  KES ${t.totalFare}`));
    console.log(`\nTo clean up: bun scripts/seed-active-trips.ts --riderId ${riderId} --clear`);

    await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
