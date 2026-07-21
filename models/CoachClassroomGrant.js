import mongoose from "mongoose";

/**
 * A coach's standing access to one classroom's talk data. One document per
 * coach–classroom pair governs the whole relationship lifetime ("minimum
 * permission traffic"): the aggregate tier is activated by the classroom's
 * lead teacher (or an admin) approving the coach's request; the transcript
 * tier is a separate admin-only flag on the same document.
 *
 * A coach may only request classrooms whose lead or assistant teacher is
 * one of their assigned teachers (Teacher.coachId) — enforced at the
 * request endpoint, and re-checked on unassignment (grants qualified only
 * by the unassigned teacher are auto-revoked).
 */
const coachClassroomGrantSchema = new mongoose.Schema(
    {
        coachId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Coach",
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
            enum: ["pending", "active", "revoked"],
            default: "pending",
            index: true,
        },
        /** Admin-only transcript tier. Meaningless unless status is "active". */
        transcriptAccess: {
            type: Boolean,
            default: false,
        },
        /** Who approved/denied/revoked the aggregate tier (teacher or admin id). */
        decidedBy: {
            type: mongoose.Schema.Types.ObjectId,
        },
        decidedByRole: {
            type: String,
            enum: ["teacher", "admin"],
        },
        /** Which admin last changed the transcript tier. */
        transcriptDecidedBy: {
            type: mongoose.Schema.Types.ObjectId,
        },
        requestedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { timestamps: true }
);

coachClassroomGrantSchema.index({ coachId: 1, classroomId: 1 }, { unique: true });

const CoachClassroomGrant = mongoose.model("CoachClassroomGrant", coachClassroomGrantSchema);
export default CoachClassroomGrant;
