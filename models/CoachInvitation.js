import mongoose from "mongoose";
import crypto from "crypto";

/**
 * Admin-sent invitation for a coach account (mirrors TeacherInvitation).
 * Coaches can only be created through this flow — there is no open
 * coach registration.
 */
const coachInvitationSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
    },
    firstName: {
        type: String,
        required: true,
    },
    lastName: {
        type: String,
        required: true,
    },
    token: {
        type: String,
        required: true,
        unique: true,
    },
    sentBy: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    sentByRole: {
        type: String,
        required: true,
        enum: ["admin"],
    },
    status: {
        type: String,
        enum: ["pending", "accepted", "expired"],
        default: "pending",
    },
    expiresAt: {
        type: Date,
        required: true,
        default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
    acceptedAt: {
        type: Date,
    },
}, {
    timestamps: true
});

coachInvitationSchema.statics.generateToken = function () {
    return crypto.randomBytes(32).toString('hex');
};

coachInvitationSchema.methods.isExpired = function () {
    return new Date() > this.expiresAt;
};

coachInvitationSchema.methods.isValid = function () {
    return this.status === 'pending' && !this.isExpired();
};

const CoachInvitation = mongoose.model("CoachInvitation", coachInvitationSchema);

export default CoachInvitation;
