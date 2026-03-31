import mongoose, { type Document, Schema } from "mongoose";
import bcrypt from "bcryptjs";
import type { RiderStatus } from "../types";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface IVehicle {
    plateNumber: string;
    make: string;
    model: string;
    year: number;
    color: string;
    chassisNumber?: string;
    engineNumber?: string;
}

export type DocumentType =
    | "national_id"
    | "driving_license"
    | "psv_license"
    | "vehicle_registration"
    | "insurance"
    | "good_conduct"
    | "selfie_with_id";

export interface IDocument {
    type: DocumentType;
    url: string;
    verified: boolean;
    uploadedAt: Date;
}

export interface IRiderProfile {
    vehicle: IVehicle;
    documents: IDocument[];
    deliveryExperience?: string;
    applicationSubmitted: boolean;
    rating: number;
    totalRatings: number;
    totalTrips: number;
    totalEarnings: number;
    isVerified: boolean;
    isApproved: boolean;
    currentStatus: RiderStatus;
    lastLocation?: {
        type: "Point";
        coordinates: [number, number]; // [lng, lat]
        updatedAt: Date;
    };
}

export interface IEmergencyContact {
    name: string;
    phone: string;
    relationship: string;
}

export interface IUser extends Document {
    _id: mongoose.Types.ObjectId;
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    password?: string;
    avatar?: string;
    role: "rider" | "customer" | "admin";
    isActive: boolean;
    isPhoneVerified: boolean;
    fcmToken?: string;

    // Extended personal profile
    dateOfBirth?: Date;
    gender?: "male" | "female" | "other" | "prefer_not_to_say";
    city?: string;
    address?: string;
    emergencyContact?: IEmergencyContact;

    riderProfile?: IRiderProfile;

    createdAt: Date;
    updatedAt: Date;

    comparePassword(candidatePassword: string): Promise<boolean>;
    toPublicJSON(): Partial<IUser>;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const VehicleSchema = new Schema<IVehicle>(
    {
        plateNumber: { type: String, required: true, uppercase: true, trim: true },
        make: { type: String, required: true },
        model: { type: String, required: true },
        year: { type: Number, required: true },
        color: { type: String, required: true },
        chassisNumber: { type: String },
        engineNumber: { type: String },
    },
    { _id: false }
);

const DOC_TYPES: DocumentType[] = [
    "national_id",
    "driving_license",
    "psv_license",
    "vehicle_registration",
    "insurance",
    "good_conduct",
    "selfie_with_id",
];

const DocumentSchema = new Schema<IDocument>(
    {
        type: { type: String, enum: DOC_TYPES, required: true },
        url: { type: String, required: true },
        verified: { type: Boolean, default: false },
        uploadedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const EmergencyContactSchema = new Schema<IEmergencyContact>(
    {
        name: { type: String, required: true },
        phone: { type: String, required: true },
        relationship: { type: String, required: true },
    },
    { _id: false }
);

const RiderProfileSchema = new Schema<IRiderProfile>(
    {
        vehicle: VehicleSchema,
        documents: [DocumentSchema],
        deliveryExperience: { type: String },
        applicationSubmitted: { type: Boolean, default: false },
        rating: { type: Number, default: 0, min: 0, max: 5 },
        totalRatings: { type: Number, default: 0 },
        totalTrips: { type: Number, default: 0 },
        totalEarnings: { type: Number, default: 0 },
        isVerified: { type: Boolean, default: false },
        isApproved: { type: Boolean, default: false },
        currentStatus: {
            type: String,
            enum: ["offline", "online", "on_trip"],
            default: "offline",
        },
        lastLocation: {
            type: {
                type: String,
                enum: ["Point"],
                default: "Point",
            },
            coordinates: { type: [Number] },
            updatedAt: { type: Date },
        },
    },
    { _id: false }
);

const UserSchema = new Schema<IUser>(
    {
        firstName: { type: String, required: false, default: '', trim: true },
        lastName:  { type: String, required: false, default: '', trim: true },
        phone: { type: String, required: true, unique: true, trim: true, index: true },
        email: { type: String, sparse: true, lowercase: true, trim: true },
        password: { type: String, minlength: 6 },
        avatar: { type: String },
        role: {
            type: String,
            enum: ["rider", "customer", "admin"],
            required: true,
            default: "rider",
        },
        isActive: { type: Boolean, default: true },
        isPhoneVerified: { type: Boolean, default: false },
        fcmToken: { type: String },

        // Extended personal profile
        dateOfBirth: { type: Date },
        gender: { type: String, enum: ["male", "female", "other", "prefer_not_to_say"] },
        city: { type: String },
        address: { type: String },
        emergencyContact: EmergencyContactSchema,

        riderProfile: RiderProfileSchema,
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────────

UserSchema.virtual("fullName").get(function (this: IUser) {
    return `${this.firstName} ${this.lastName}`.trim();
});

// ─── Indexes ──────────────────────────────────────────────────────────────────

UserSchema.index({ "riderProfile.lastLocation": "2dsphere" });
UserSchema.index({ "riderProfile.currentStatus": 1 });

// ─── Hooks ────────────────────────────────────────────────────────────────────

UserSchema.pre<IUser>("save", async function () {
    if (!this.isModified("password") || !this.password) return;
    // Skip if already a bcrypt hash (stored pre-hashed from pending registration)
    if (this.password.startsWith("$2")) return;
    this.password = await bcrypt.hash(this.password, 12);
});

// ─── Methods ──────────────────────────────────────────────────────────────────

UserSchema.methods.comparePassword = async function (
    candidatePassword: string
): Promise<boolean> {
    if (!this.password) return false;
    return bcrypt.compare(candidatePassword, this.password);
};

UserSchema.methods.toPublicJSON = function (): Partial<IUser> {
    const obj = this.toObject();
    delete obj.password;
    return obj;
};

export const User = mongoose.model<IUser>("User", UserSchema);
