import mongoose from "mongoose";
import crypto from "crypto";

const invitationSchema = new mongoose.Schema({
    email: { 
        type: String, 
        required: true 
    },
    /** @deprecated Use childIds; kept for legacy records and first-child shorthand */
    childId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Child",
        required: false,
    },
    /** All children covered by this invitation (min length 1 when saved). Order preserved. */
    childIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Child" }],
    token: { 
        type: String, 
        required: true, 
        unique: true 
    },
    sentBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true 
    }, // Admin or Teacher ID
    sentByRole: { 
        type: String, 
        required: true, 
        enum: ["admin", "teacher"] 
    },
    status: { 
        type: String, 
        enum: ["pending", "accepted", "expired"], 
        default: "pending" 
    },
    expiresAt: { 
        type: Date, 
        required: true,
        default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now
    },
    acceptedAt: { 
        type: Date 
    },
    /** True only when Enact check-email returned { exists: true } at invite time */
    enactEmailExists: {
        type: Boolean,
        default: false,
    },
}, {
    timestamps: true
});

// Generate unique token
invitationSchema.statics.generateToken = function() {
    return crypto.randomBytes(32).toString('hex');
};

// Check if invitation is expired
invitationSchema.methods.isExpired = function() {
    return new Date() > this.expiresAt;
};

// Check if invitation is valid
invitationSchema.methods.isValid = function() {
    return this.status === 'pending' && !this.isExpired();
};

const Invitation = mongoose.model("Invitation", invitationSchema);

export default Invitation;

