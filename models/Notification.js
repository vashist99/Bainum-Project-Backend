import mongoose from "mongoose";

/**
 * In-app notification. The collection is self-pruning via a MongoDB TTL
 * index on `expiresAt`; every row's lifetime is exactly 10 days from
 * creation. We do NOT track read/unread state — the bell badge counts
 * "alive" notifications and the user can dismiss early via
 * DELETE /api/notifications/:id, but the TTL is the lifecycle guarantee.
 *
 * `type` is an open enum so future event kinds can be added without a
 * schema migration; this change wires up `classroom-added` and
 * `classroom-removed`.
 *
 * `classroomName` is denormalized at creation time so a later rename
 * or hard-delete of the classroom does not leave the notification text
 * out of sync.
 */
const notificationSchema = new mongoose.Schema(
    {
        recipientId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        recipientRole: {
            type: String,
            enum: ["parent", "teacher", "admin"],
            required: true,
        },
        type: {
            type: String,
            enum: ["classroom-added", "classroom-removed"],
            required: true,
        },
        classroomId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Classroom",
            default: null,
            index: true,
        },
        classroomName: { type: String, default: "" },
        message: { type: String, required: true },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

// Self-pruning collection: MongoDB's TTL monitor (runs ~every 60s)
// removes any document whose `expiresAt` is in the past.
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound query path used by the bell dropdown and by the teacher
// idempotency check ("has T already been notified about classroom C?").
notificationSchema.index({ recipientId: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
