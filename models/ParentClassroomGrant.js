import mongoose from "mongoose";

/**
 * Lead-teacher-controlled classroom chart access for an enrolled parent.
 * Missing row + enrolled = charts on. status "revoked" is sticky.
 */
const parentClassroomGrantSchema = new mongoose.Schema(
    {
        parentId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Parent",
            required: true,
            index: true,
        },
        classroomId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Classroom",
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["active", "revoked"],
            default: "active",
            index: true,
        },
    },
    { timestamps: true }
);

parentClassroomGrantSchema.index({ parentId: 1, classroomId: 1 }, { unique: true });

const ParentClassroomGrant = mongoose.model("ParentClassroomGrant", parentClassroomGrantSchema);
export default ParentClassroomGrant;
