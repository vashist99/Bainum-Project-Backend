import Notification from "../models/Notification.js";

/**
 * Fixed TTL window for every notification created here. Aligns with the
 * spec's "10 days, then auto-delete via MongoDB TTL monitor".
 */
export const NOTIFICATION_TTL_MS = 10 * 24 * 60 * 60 * 1000;

function buildExpiresAt(now = new Date()) {
    return new Date(now.getTime() + NOTIFICATION_TTL_MS);
}

function classroomNameOf(classroom) {
    if (!classroom) return "";
    return typeof classroom.name === "string" ? classroom.name : "";
}

/**
 * Insert a single `classroom-added` notification. Returns the created
 * document (or null if `Notification.create` failed — callers MUST NOT
 * roll back the surrounding business write on a notification error).
 */
export async function createClassroomAddedNotification({
    recipientId,
    recipientRole,
    classroom,
}) {
    if (!recipientId || !recipientRole || !classroom) return null;
    const name = classroomNameOf(classroom);
    try {
        return await Notification.create({
            recipientId,
            recipientRole,
            type: "classroom-added",
            classroomId: classroom._id ?? classroom.id ?? null,
            classroomName: name,
            message: `You have been added to a classroom: "${name}"`,
            expiresAt: buildExpiresAt(),
        });
    } catch (error) {
        console.error(
            "[notificationService] createClassroomAddedNotification failed:",
            error.message
        );
        return null;
    }
}

/**
 * Insert a single `classroom-removed` notification. Same failure mode
 * as `createClassroomAddedNotification`.
 */
export async function createClassroomRemovedNotification({
    recipientId,
    recipientRole,
    classroom,
}) {
    if (!recipientId || !recipientRole || !classroom) return null;
    const name = classroomNameOf(classroom);
    try {
        return await Notification.create({
            recipientId,
            recipientRole,
            type: "classroom-removed",
            classroomId: classroom._id ?? classroom.id ?? null,
            classroomName: name,
            message: `You have been removed from classroom: "${name}"`,
            expiresAt: buildExpiresAt(),
        });
    } catch (error) {
        console.error(
            "[notificationService] createClassroomRemovedNotification failed:",
            error.message
        );
        return null;
    }
}

/**
 * Emit `classroom-added` notifications for everyone in `recipients`,
 * skipping any recipient that ALREADY has an unexpired `classroom-added`
 * row for this classroom. This is what gives teachers their
 * "notified-once-per-room-per-TTL-window" behavior; parents pass through
 * unconditionally (callers ensure parents in `recipients` are the
 * newly-added ones only).
 *
 * `recipients`: Array<{ id, role: "parent" | "teacher" | "admin" }>
 */
export async function fanOutClassroomAddedNotifications({
    classroom,
    recipients,
}) {
    if (!classroom || !Array.isArray(recipients) || recipients.length === 0) {
        return [];
    }
    const created = [];
    for (const recipient of recipients) {
        if (!recipient?.id || !recipient?.role) continue;
        const existing = await Notification.exists({
            recipientId: recipient.id,
            classroomId: classroom._id ?? classroom.id,
            type: "classroom-added",
        }).catch(() => null);
        if (existing) continue;
        const doc = await createClassroomAddedNotification({
            recipientId: recipient.id,
            recipientRole: recipient.role,
            classroom,
        });
        if (doc) created.push(doc);
    }
    return created;
}

/**
 * Emit a single `classroom-removed` notification for the pruned parent.
 * No idempotency check: every prune emits one (re-add → remove cycles
 * are real events and re-notifying is correct).
 */
export async function fanOutClassroomRemovedNotification({
    classroom,
    parentId,
}) {
    if (!classroom || !parentId) return null;
    return createClassroomRemovedNotification({
        recipientId: parentId,
        recipientRole: "parent",
        classroom,
    });
}
