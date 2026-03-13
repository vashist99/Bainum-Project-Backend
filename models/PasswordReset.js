import mongoose from "mongoose";
import crypto from "crypto";

const passwordResetSchema = new mongoose.Schema({
    email: { type: String, required: true },
    token: { type: String, required: true, unique: true },
    userType: { type: String, required: true, enum: ["admin", "teacher", "parent"] },
    expiresAt: {
        type: Date,
        required: true,
        default: () => new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    },
    usedAt: { type: Date },
}, { timestamps: true });

passwordResetSchema.statics.generateToken = function () {
    return crypto.randomBytes(32).toString("hex");
};

passwordResetSchema.methods.isExpired = function () {
    return new Date() > this.expiresAt;
};

passwordResetSchema.methods.isValid = function () {
    return !this.usedAt && !this.isExpired();
};

const PasswordReset = mongoose.model("PasswordReset", passwordResetSchema);
export default PasswordReset;
