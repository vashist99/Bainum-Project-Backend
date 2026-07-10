import mongoose from "mongoose";

/**
 * Parent-controlled access to a child's HOME talk data (activityContext
 * 'home'). Staff never see home recordings unless one of these grants is
 * active. Two shapes:
 *
 * - scope "user":      one specific staff member (teacher or admin).
 *   Per-classroom grant buttons resolve to the classroom's lead teacher
 *   AT GRANT TIME (classroomId kept for display); a later lead
 *   reassignment does NOT transfer access.
 * - scope "all-staff": every teacher and admin (granteeId absent).
 *
 * Staff "request access" creates the same document with status
 * "pending"; parent approval flips it to "active". Grants are NEVER
 * auto-created by invitation/classroom flows — only via the
 * /api/home-access endpoints.
 */
const homeViewGrantSchema = new mongoose.Schema(
    {
        childId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Child",
            required: true,
            index: true,
        },
        scope: {
            type: String,
            enum: ["user", "all-staff"],
            required: true,
        },
        granteeId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
            required: function requiredForUserScope() {
                return this.scope === "user";
            },
        },
        granteeRole: {
            type: String,
            enum: ["teacher", "admin"],
            default: null,
            required: function requiredForUserScope() {
                return this.scope === "user";
            },
        },
        /** Classroom the per-classroom grant button belonged to (display only). */
        classroomId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Classroom",
            default: null,
        },
        status: {
            type: String,
            enum: ["pending", "active", "revoked"],
            default: "pending",
            index: true,
        },
        initiatedBy: {
            type: String,
            enum: ["parent", "staff"],
            required: true,
        },
    },
    { timestamps: true }
);

// One document per (child, scope, grantee). granteeId is null for
// all-staff, so a child can hold at most one all-staff grant.
homeViewGrantSchema.index({ childId: 1, scope: 1, granteeId: 1 }, { unique: true });
homeViewGrantSchema.index({ childId: 1, status: 1 });

const HomeViewGrant = mongoose.model("HomeViewGrant", homeViewGrantSchema);
export default HomeViewGrant;
