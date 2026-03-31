import mongoose, { type Document, Schema } from "mongoose";
import type { TripStatus } from "../types";

//Interfaces

export interface IAddress {
    address: string;
    latitude: number;
    longitude: number;
    landmark?: string;
}

export interface IParcel {
    description: string;
    weight?: number;   // kg
    size?: "small" | "medium" | "large";
    isFragile?: boolean;
    specialInstructions?: string;
}

export interface IRating {
    score: number;      // 1-5
    comment?: string;
    ratedAt: Date;
}

export interface IStatusHistory {
    status: TripStatus;
    timestamp: Date;
    note?: string;
    location?: { latitude: number; longitude: number };
}

export interface ITrip extends Document {
    _id: mongoose.Types.ObjectId;

    // Parties
    customerId: mongoose.Types.ObjectId;
    riderId?: mongoose.Types.ObjectId;

    // Locations
    pickup: IAddress;
    dropoff: IAddress;
    waypoints?: IAddress[];

    // Parcel info
    parcel: IParcel;

    // Pricing
    distanceKm: number;
    estimatedMinutes: number;
    baseFare: number;
    distanceFare: number;
    totalFare: number;
    currency: string;

    // Status
    status: TripStatus;
    statusHistory: IStatusHistory[];

    // Proof of delivery
    proofOfDelivery?: {
        photoUrl: string;
        recipientName?: string;
        signature?: string;
        uploadedAt: Date;
    };

    // Ratings
    customerRating?: IRating;
    riderRating?: IRating;

    // Cancellation
    cancelledBy?: "customer" | "rider" | "system";
    cancellationReason?: string;

    // Tracking
    acceptedAt?: Date;
    pickedUpAt?: Date;
    deliveredAt?: Date;
    cancelledAt?: Date;

    createdAt: Date;
    updatedAt: Date;
}

//Schema

const AddressSchema = new Schema<IAddress>(
    {
        address: { type: String, required: true },
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
        landmark: { type: String },
    },
    { _id: false }
);

const ParcelSchema = new Schema<IParcel>(
    {
        description: { type: String, required: true },
        weight: { type: Number },
        size: { type: String, enum: ["small", "medium", "large"] },
        isFragile: { type: Boolean, default: false },
        specialInstructions: { type: String },
    },
    { _id: false }
);

const RatingSchema = new Schema<IRating>(
    {
        score: { type: Number, required: true, min: 1, max: 5 },
        comment: { type: String },
        ratedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const StatusHistorySchema = new Schema<IStatusHistory>(
    {
        status: {
            type: String,
            enum: ["pending", "accepted", "picked_up", "in_transit", "delivered", "cancelled", "failed"],
            required: true,
        },
        timestamp: { type: Date, default: Date.now },
        note: { type: String },
        location: {
            latitude: { type: Number },
            longitude: { type: Number },
        },
    },
    { _id: false }
);

const TripSchema = new Schema<ITrip>(
    {
        customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
        riderId: { type: Schema.Types.ObjectId, ref: "User", index: true },

        pickup: { type: AddressSchema, required: true },
        dropoff: { type: AddressSchema, required: true },
        waypoints: [AddressSchema],

        parcel: { type: ParcelSchema, required: true },

        distanceKm: { type: Number, required: true },
        estimatedMinutes: { type: Number, required: true },
        baseFare: { type: Number, required: true },
        distanceFare: { type: Number, required: true },
        totalFare: { type: Number, required: true },
        currency: { type: String, default: "KES" },

        status: {
            type: String,
            enum: ["pending", "accepted", "picked_up", "in_transit", "delivered", "cancelled", "failed"],
            default: "pending",
            index: true,
        },
        statusHistory: [StatusHistorySchema],

        proofOfDelivery: {
            photoUrl: { type: String },
            recipientName: { type: String },
            signature: { type: String },
            uploadedAt: { type: Date },
        },

        customerRating: RatingSchema,
        riderRating: RatingSchema,

        cancelledBy: { type: String, enum: ["customer", "rider", "system"] },
        cancellationReason: { type: String },

        acceptedAt: { type: Date },
        pickedUpAt: { type: Date },
        deliveredAt: { type: Date },
        cancelledAt: { type: Date },
    },
    { timestamps: true }
);

//Indexes

TripSchema.index({ status: 1, createdAt: -1 });
TripSchema.index({ riderId: 1, status: 1 });
TripSchema.index({ customerId: 1, createdAt: -1 });

export const Trip = mongoose.model<ITrip>("Trip", TripSchema);
