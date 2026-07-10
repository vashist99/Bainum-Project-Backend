import mongoose from "mongoose";

/**
 * In-app notification. The collection is self-pruning via a MongoDB TTL
 * index on `expiresAt`; every row's lifetime is exactly 10 days from
 * creation. We do NOT track read/unread state — the bell badge counts
 * "alive" notifications and the user can dismiss early via
 * DELETE /api/notifications/:id, but the TTL is the lifecycle guarantee.
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
            enum: [
                "classroom-added",
                "classroom-removed",
                "child-note-added",
                "classroom-note-added",
                "classroom-recording-added",
                "home-access-requested",
            ],
            required: true,
        },
        classroomId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Classroom",
            default: null,
            index: true,
        },
        classroomName: { type: String, default: "" },
        childId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Child",
            default: null,
            index: true,
        },
        childName: { type: String, default: "" },
        message: { type: String, required: true },
        expiresAt: { type: Date, required: true },
    },
    { timestamps: { createdAt: true, updatedAt: false } }
);

notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
notificationSchema.index({ recipientId: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);

export default Notification;
