import mongoose from "mongoose";
import crypto from "crypto";

const invitationSchema = new mongoose.Schema({
    email: { 
        type: String, 
        required: true 
    },
    // Teacher details stored in invitation (will be used when teacher accepts)
    firstName: { 
        type: String, 
        required: true 
    },
    lastName: { 
        type: String, 
        required: true 
    },
    education: { 
        type: String, 
        required: true 
    },
    dateOfBirth: { 
        type: Date, 
        required: true 
    },
    center: { 
        type: String, 
        required: true 
    },
    token: { 
        type: String, 
        required: true, 
        unique: true 
    },
    sentBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        required: true 
    }, // Admin ID
    sentByRole: { 
        type: String, 
        required: true, 
        enum: ["admin"] 
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

const TeacherInvitation = mongoose.model("TeacherInvitation", invitationSchema);

export default TeacherInvitation;

