import mongoose from "mongoose";

/**
 * Links a teacher and parent for a specific child so they can share the agreed data:
 * - Teacher may view child data after parent accepts an invite (or grant is active).
 * - Parent may view teacher data after both sides agree (active grant).
 */
const accessGrantSchema = new mongoose.Schema(
    {
        childId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Child",
            required: true,
            index: true,
        },
        teacherId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Teacher",
            required: true,
            index: true,
        },
        parentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Parent",
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["pending", "active", "revoked"],
            default: "pending",
            index: true,
        },
        /** Who created the grant request */
        initiatedBy: {
            type: String,
            enum: ["teacher", "parent"],
            required: true,
        },
    },
    { timestamps: true }
);

accessGrantSchema.index({ childId: 1, teacherId: 1, parentId: 1 }, { unique: true });

const AccessGrant = mongoose.model("AccessGrant", accessGrantSchema);
export default AccessGrant;
