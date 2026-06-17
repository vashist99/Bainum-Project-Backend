import mongoose from "mongoose";
import Notification from "../models/Notification.js";

const MAX_LIST_SIZE = 50;

/**
 * GET /api/notifications
 *
 * Returns the caller's UNEXPIRED notifications (the TTL monitor lags
 * up to ~60s, so we also filter `expiresAt > now` inline so the API
 * never serves a stale row that the bell would then render). Sorted
 * by `createdAt` descending; capped at MAX_LIST_SIZE.
 */
export const listNotifications = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: "Authentication required" });
        }
        const now = new Date();
        const notifications = await Notification.find({
            recipientId: req.user.id,
            expiresAt: { $gt: now },
        })
            .sort({ createdAt: -1 })
            .limit(MAX_LIST_SIZE)
            .lean();

        return res.status(200).json({
            notifications: notifications.map((n) => ({
                id: n._id,
                type: n.type,
                classroomId: n.classroomId,
                classroomName: n.classroomName,
                message: n.message,
                createdAt: n.createdAt,
                expiresAt: n.expiresAt,
            })),
        });
    } catch (error) {
        console.error("Error listing notifications:", error);
        return res.status(500).json({ message: error.message });
    }
};

/**
 * DELETE /api/notifications/:id
 *
 * Removes a single notification iff it belongs to the caller. 404 on
 * missing id; 403 on a row that exists but belongs to someone else.
 */
export const dismissNotification = async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: "Authentication required" });
        }
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid notification id" });
        }

        const notification = await Notification.findById(id);
        if (!notification) {
            return res.status(404).json({ message: "Notification not found" });
        }
        if (String(notification.recipientId) !== String(req.user.id)) {
            return res
                .status(403)
                .json({ message: "You cannot dismiss another user's notification" });
        }

        await Notification.deleteOne({ _id: notification._id });
        return res.status(200).json({ ok: true, dismissedId: String(id) });
    } catch (error) {
        console.error("Error dismissing notification:", error);
        return res.status(500).json({ message: error.message });
    }
};
