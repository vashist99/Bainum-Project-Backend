import { isSameCenter } from "./centerNames.js";

function idOf(value) {
    if (value == null) return "";
    return String(value._id ?? value.id ?? value);
}

/**
 * Single authorization gate for classroom administration: admins manage any
 * classroom; teachers manage classrooms where they are the lead OR the
 * assistant. Everyone else (parents, unknown roles) is denied. Every
 * classroom endpoint (detail, invite, eligible-parents, assessments,
 * classroom-scoped recording) must route through this helper so assistant
 * access can never drift out of sync between endpoints.
 */
export function canManageClassroom(user, classroom) {
    if (!user || !classroom) return false;
    if (user.role === "admin") return true;
    if (user.role !== "teacher") return false;
    const uid = idOf(user);
    if (!uid) return false;
    if (uid === idOf(classroom.teacher)) return true;
    const assistantId = idOf(classroom.assistantTeacher);
    return assistantId !== "" && uid === assistantId;
}

/**
 * "lead" | "assistant" | null for a teacher user on a classroom (admins get null).
 */
export function classroomRoleForUser(user, classroom) {
    if (!user || !classroom || user.role !== "teacher") return null;
    const uid = idOf(user);
    if (!uid) return null;
    if (uid === idOf(classroom.teacher)) return "lead";
    const assistantId = idOf(classroom.assistantTeacher);
    if (assistantId !== "" && uid === assistantId) return "assistant";
    return null;
}

/**
 * Validate an assistant-teacher selection against the classroom's lead and center.
 * Pure (takes docs, hits no DB) so it is unit-testable.
 */
export function validateAssistant({ leadId, assistantDoc, classroomCenter }) {
    if (!assistantDoc) {
        return { ok: false, message: "Assistant teacher not found" };
    }
    if (idOf(assistantDoc) === String(leadId)) {
        return { ok: false, message: "Assistant teacher cannot be the same as the lead teacher" };
    }
    if (!isSameCenter(assistantDoc.center, classroomCenter)) {
        return { ok: false, message: "Assistant teacher must belong to the classroom's school" };
    }
    return { ok: true };
}

/**
 * Parse a classroom-invite request body into normalized entries.
 * New shape: `invites: [{ parentId, childIds?: [] }]` — childIds omitted/null
 * means "enroll all eligible children". Legacy shape: `parentIds: []` (= all
 * eligible children for each parent). Returns
 * `{ ok: true, entries: [{ parentId, childIds: string[]|null }] }` or
 * `{ ok: false, message }`. Pure — id existence/ownership is checked later
 * against the DB.
 */
export function parseInvitePayload(body) {
    const { invites, parentIds } = body || {};

    if (Array.isArray(invites)) {
        if (invites.length === 0) {
            return { ok: false, message: "Select at least one parent to invite" };
        }
        const entries = [];
        for (const entry of invites) {
            const parentId = entry?.parentId;
            if (!parentId || typeof parentId !== "string") {
                return { ok: false, message: "Each invite needs a parentId" };
            }
            let childIds = null;
            if (entry.childIds != null) {
                if (!Array.isArray(entry.childIds)) {
                    return { ok: false, message: "childIds must be a list" };
                }
                childIds = entry.childIds.map(String);
            }
            entries.push({ parentId: String(parentId), childIds });
        }
        return { ok: true, entries };
    }

    if (Array.isArray(parentIds) && parentIds.length > 0) {
        return {
            ok: true,
            entries: parentIds.map((id) => ({ parentId: String(id), childIds: null })),
        };
    }

    return { ok: false, message: "Select at least one parent to invite" };
}

/**
 * A child's center is now a first-class field on the Child document
 * (`child.center`), set at create time. Returns the center name string,
 * or null when the child has no recorded center (legacy data that
 * predates this change and has not been migrated).
 *
 * Async signature is preserved for backward compatibility with existing
 * callers; consider awaiting it everywhere it's used.
 */
export async function resolveChildCenter(child) {
    const raw = child?.center;
    const trimmed = typeof raw === "string" ? raw.trim() : "";
    return trimmed || null;
}
