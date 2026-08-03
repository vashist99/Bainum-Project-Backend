import ActivityLog, {
    ACTIVITY_LOG_RETENTION_DAYS,
    LOGGED_ROLES,
} from "../models/ActivityLog.js";

/**
 * Fire-and-forget activity logging for the admin "Activities log" view.
 *
 * This is the SINGLE enforcement point for who gets logged: anything not
 * performed by a teacher or coach is silently dropped, so call sites never
 * need role checks (admin-initiated variants of shared handlers simply
 * produce no row).
 *
 * Never throws and never blocks the caller's response — call as
 * `void logActivity({...})` after the mutation has succeeded.
 *
 * @param {object} params
 * @param {{id: string, role: string, name?: string}} params.actor  req.user
 * @param {string} params.action        one of ACTIVITY_ACTIONS
 * @param {string} [params.targetType]  "classroom" | "child" | "assessment" | "grant" | "profile"
 * @param {string} [params.targetId]
 * @param {string} [params.targetLabel] human-readable target name
 * @param {string} [params.detail]      short fragment; NEVER talk-data content
 */
export async function logActivity({
    actor,
    action,
    targetType = null,
    targetId = null,
    targetLabel = "",
    detail = "",
} = {}) {
    try {
        if (!actor?.id || !LOGGED_ROLES.includes(actor.role)) return null;
        const expiresAt = new Date(
            Date.now() + ACTIVITY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
        );
        return await ActivityLog.create({
            actorId: actor.id,
            actorRole: actor.role,
            actorName: actor.name || "",
            action,
            targetType,
            targetId: targetId || null,
            targetLabel: targetLabel || "",
            detail: detail || "",
            expiresAt,
        });
    } catch (error) {
        // Logging must never affect the logged action.
        console.error("Activity log write failed:", error.message);
        return null;
    }
}
