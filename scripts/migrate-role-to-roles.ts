/**
 * One-time migration: convert legacy `role: string` field to `roles: string[]`.
 *
 * Safe to run multiple times — only touches documents where `roles` is missing
 * or empty, and `role` exists.
 *
 * Usage:
 *   bun scripts/migrate-role-to-roles.ts
 *
 * Requires MONGO_URI in .env.
 */
import "dotenv/config";
import mongoose from "mongoose";

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("❌  MONGO_URI is not set in .env");
    process.exit(1);
}

async function main() {
    await mongoose.connect(MONGO_URI!);
    console.log("✅  Connected to MongoDB");

    const db = mongoose.connection.db!;
    const users = db.collection("users");

    // Find every document that still has the old `role` field
    // and either has no `roles` field or an empty array.
    const result = await users.updateMany(
        {
            role: { $exists: true },
            $or: [
                { roles: { $exists: false } },
                { roles: { $size: 0 } },
            ],
        },
        [
            // Aggregation pipeline update — copies `role` into `roles` array
            { $set: { roles: ["$role"] } },
        ]
    );

    console.log(`✅  Migrated ${result.modifiedCount} user(s)`);
    console.log(`   matched:  ${result.matchedCount}`);
    console.log(`   modified: ${result.modifiedCount}`);

    await mongoose.disconnect();
    console.log("✅  Done");
}

main().catch((err) => {
    console.error("❌  Migration failed:", err);
    process.exit(1);
});
