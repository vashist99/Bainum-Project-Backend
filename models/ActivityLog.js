import mongoose from "mongoose";

/**
 * Activity-log entry: a metadata-only record of a curated action performed
 * by a TEACHER or COACH (never admins or parents — enforced in
 * lib/activityLogService.js, the only writer). Self-pruning via a MongoDB
 * TTL index on `expiresAt`; every row's lifetime is 90 days from creation.
 *
 * Entries must NEVER contain talk-data content (transcript text, audio
 * references, keyword counts) — only actor identity, the action, and a
 * human-readable target label/detail.
 */

/** Closed action set. Adding an action = enum entry + one call site. */
export const ACTIVITY_ACTIONS = Object.freeze([
    "login",
    "recording-uploaded",
    "transcript-accepted",
    "transcript-rejected",
    "classroom-created",
    "classroom-updated",
    "classroom-deleted",
    "roster-parents-added",
    "roster-child-removed",
    "coach-access-requested",
    "coach-grant-approved",
    "coach-grant-denied",
    "coach-grant-revoked",
    "home-access-requested",
    "profile-updated",
]);

/** Only these roles ever appear as actors. */
export const LOGGED_ROLES = Object.freeze(["teacher", "coach"]);

/** Retention window enforced by the TTL index. */
export const ACTIVITY_LOG_RETENTION_DAYS = 90;

const activityLogSchema = new mongoose.Schema(
    {
        actorId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        actorRole: {
            type: String,
            enum: LOGGED_ROLES,
            required: true,
        },
        /** Denormalized so rows stay readable after account deletion. */
        actorName: { type: String, default: "" },
        action: {
            type: String,
            enum: ACTIVITY_ACTIONS,
            required: true,
            index: true,
        },
        /** e.g. "classroom" | "child" | "assessment" | "grant" | "profile" */
        targetType: { type: String, default: null },
        targetId: { type: mongoose.Schema.Types.ObjectId, default: null },
        /** Human-readable target, e.g. the classroom name at action time. */
        targetLabel: { type: String, default: "" },
        /** Short pre-rendered fragment; never talk-data content. */
        detail: { type: String, default: "" },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

activityLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ actorId: 1, createdAt: -1 });

const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);

export default ActivityLog;
