import { Elysia, t } from "elysia";
import { authPlugin } from "../middleware/auth.middleware";
import { User } from "../models/User";
import { StorageService } from "../services/storage.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "../utils/errors";

const DOC_TYPE_ENUM = {
    national_id:          "national_id",
    driving_license:      "driving_license",
    psv_license:          "psv_license",
    vehicle_registration: "vehicle_registration",
    insurance:            "insurance",
    good_conduct:         "good_conduct",
    selfie_with_id:       "selfie_with_id",
} as const;

// Accepted MIME types for KYC documents
const DOC_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf",
    "application/msword",                                                    // .doc
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
] as const;

export const profileRoutes = new Elysia({ prefix: "/api/profile" })
    .use(authPlugin)
    .guard({ isAuth: true })

    // ─── View own profile ─────────────────────────────────────────────────────

    .get("/", async ({ user }) => {
        const dbUser = await User.findById(user!.id).select("-password");
        if (!dbUser) throw new NotFoundError("User not found.");
        return { success: true, message: "Profile fetched", data: dbUser };
    })

    // ─── Update personal info (all roles) ─────────────────────────────────────

    .patch("/", async ({ user, body }) => {
        const dbUser = await User.findByIdAndUpdate(
            user!.id,
            { $set: body },
            { new: true, runValidators: true }
        ).select("-password");

        return { success: true, message: "Profile updated", data: dbUser };
    }, {
        body: t.Partial(t.Object({
            firstName:   t.String({ minLength: 1, maxLength: 50 }),
            lastName:    t.String({ minLength: 1, maxLength: 50 }),
            email:       t.String({ format: "email" }),
            fcmToken:    t.String(),
            dateOfBirth: t.String(),   // ISO date string, e.g. "1995-03-15"
            gender:      t.Union([
                t.Literal("male"), t.Literal("female"),
                t.Literal("other"), t.Literal("prefer_not_to_say"),
            ]),
            city:    t.String({ maxLength: 100 }),
            address: t.String({ maxLength: 300 }),
            emergencyContact: t.Object({
                name:         t.String({ minLength: 2, maxLength: 100 }),
                phone:        t.String({ minLength: 7, maxLength: 20 }),
                relationship: t.String({ minLength: 2, maxLength: 50 }),
            }),
        })),
    })

    // ─── Upload avatar (all roles) ────────────────────────────────────────────

    .put("/avatar", async ({ user, body }) => {
        if (!body.file) throw new BadRequestError("No file provided.");

        const avatarUrl = await StorageService.upload(body.file, `avatars/${user!.id}`);
        const dbUser = await User.findByIdAndUpdate(
            user!.id,
            { $set: { avatar: avatarUrl } },
            { new: true }
        ).select("-password");

        return { success: true, message: "Avatar updated", data: { avatar: avatarUrl, user: dbUser } };
    }, {
        body: t.Object({
            file: t.File({ type: ["image/jpeg", "image/png", "image/webp"] }),
        }),
    })

    // ─── Rider vehicle + experience setup ─────────────────────────────────────

    .put("/rider", async ({ user, body }) => {
        if (user!.role !== "rider") {
            throw new ForbiddenError("Only riders can set up a rider profile.");
        }

        const existing = await User.findById(user!.id).select("riderProfile");
        const isFirstSetup = !existing?.riderProfile?.currentStatus;

        const dbUser = await User.findByIdAndUpdate(
            user!.id,
            {
                $set: {
                    "riderProfile.vehicle": {
                        plateNumber:   body.plateNumber,
                        make:          body.make,
                        model:         body.model,
                        year:          body.year,
                        color:         body.color,
                        chassisNumber: body.chassisNumber,
                        engineNumber:  body.engineNumber,
                    },
                    "riderProfile.deliveryExperience": body.deliveryExperience,
                    "riderProfile.isVerified": false,
                    "riderProfile.isApproved": false,
                    "riderProfile.currentStatus": "offline",
                    ...(isFirstSetup && {
                        "riderProfile.rating": 0,
                        "riderProfile.totalRatings": 0,
                        "riderProfile.totalTrips": 0,
                        "riderProfile.totalEarnings": 0,
                        "riderProfile.documents": [],
                        "riderProfile.applicationSubmitted": false,
                    }),
                },
            },
            { new: true, runValidators: true }
        ).select("-password");

        return { success: true, message: "Rider profile updated", data: dbUser };
    }, {
        body: t.Object({
            plateNumber:        t.String({ minLength: 4, maxLength: 15 }),
            make:               t.String({ minLength: 1, maxLength: 50 }),
            model:              t.String({ minLength: 1, maxLength: 50 }),
            year:               t.Number({ minimum: 1990, maximum: new Date().getFullYear() + 1 }),
            color:              t.String({ minLength: 1, maxLength: 30 }),
            chassisNumber:      t.Optional(t.String({ maxLength: 30 })),
            engineNumber:       t.Optional(t.String({ maxLength: 30 })),
            deliveryExperience: t.Optional(t.String({ maxLength: 50 })),
        }),
    })

    // ─── Upload KYC document (riders only) ────────────────────────────────────

    .post("/documents", async ({ user, body }) => {
        if (user!.role !== "rider") {
            throw new ForbiddenError("Only riders can upload KYC documents.");
        }
        if (!body.file) throw new BadRequestError("No file provided.");

        const fileUrl = await StorageService.upload(body.file, `documents/${user!.id}`);

        // Replace existing document of the same type (upsert-style)
        await User.updateOne(
            { _id: user!.id },
            { $pull: { "riderProfile.documents": { type: body.type } } }
        );

        const dbUser = await User.findByIdAndUpdate(
            user!.id,
            {
                $push: {
                    "riderProfile.documents": {
                        type: body.type,
                        url: fileUrl,
                        verified: false,
                        uploadedAt: new Date(),
                    },
                },
            },
            { new: true }
        ).select("-password");

        return { success: true, message: "Document uploaded", data: { url: fileUrl, user: dbUser } };
    }, {
        body: t.Object({
            type: t.Enum(DOC_TYPE_ENUM),
            file: t.File({
                type: DOC_MIME_TYPES as unknown as string[],
                maxSize: 10 * 1024 * 1024, // 10 MB — Word docs can be larger
            }),
        }),
    })

    // ─── Submit application (riders only) ─────────────────────────────────────

    .post("/submit-application", async ({ user }) => {
        if (user!.role !== "rider") {
            throw new ForbiddenError("Only riders can submit an application.");
        }

        const dbUser = await User.findByIdAndUpdate(
            user!.id,
            {
                $set:   { "riderProfile.applicationSubmitted": true },
                $unset: { "riderProfile.kycRejectionReason": "" },
            },
            { new: true }
        ).select("-password");

        return { success: true, message: "Application submitted. We'll review it shortly.", data: dbUser };
    });
