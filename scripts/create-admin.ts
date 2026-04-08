/**
 * Create an admin user (bypasses public registration, which forbids role=admin).
 *
 * Usage:
 *   bun scripts/create-admin.ts --phone +15550001111 --password 'SecurePass123' --email admin@example.com
 *   bun scripts/create-admin.ts --phone +15550001111 --password 'SecurePass123' --username superadmin
 *
 * Requires MONGO_URI in .env (or environment). Other server env vars are not required for this script.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { User } from "../src/models/User";

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1 || !process.argv[i + 1]) return undefined;
    return process.argv[i + 1];
}

async function main() {
    const phone = arg("phone");
    const password = arg("password");
    const email = arg("email");
    const username = arg("username");
    const firstName = arg("firstName") ?? "Admin";
    const lastName = arg("lastName") ?? "User";

    if (!phone || !password) {
        console.error(
            "Usage: bun scripts/create-admin.ts --phone +E164 --password <secret> [--email a@b.c] [--username name] [--firstName] [--lastName]"
        );
        process.exit(1);
    }

    if (password.length < 6) {
        console.error("Password must be at least 6 characters (matches User schema).");
        process.exit(1);
    }

    const uri = process.env.MONGO_URI;
    if (!uri) {
        console.error("MONGO_URI is not set.");
        process.exit(1);
    }

    await mongoose.connect(uri);

    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
        console.error(`User with phone ${phone} already exists.`);
        process.exit(1);
    }

    if (email) {
        const e = email.trim().toLowerCase();
        const clash = await User.findOne({ email: e });
        if (clash) {
            console.error(`User with email ${e} already exists.`);
            process.exit(1);
        }
    }

    if (username) {
        const u = username.trim().toLowerCase();
        const clash = await User.findOne({ username: u });
        if (clash) {
            console.error(`User with username ${u} already exists.`);
            process.exit(1);
        }
    }

    const user = new User({
        firstName,
        lastName,
        phone,
        email: email?.trim().toLowerCase(),
        username: username?.trim().toLowerCase(),
        password,
        role: "admin",
        isActive: true,
        isPhoneVerified: true,
    });

    await user.save();
    console.log("Admin created:", user._id.toString());
    console.log("Login via POST /api/auth/admin/login with identifier = email or username.");
    await mongoose.disconnect();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
