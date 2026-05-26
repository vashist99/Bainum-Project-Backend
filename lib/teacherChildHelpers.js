import { Child } from "../models/User.js";
import AccessGrant from "../models/AccessGrant.js";

/**
 * Escape a string so it can be embedded verbatim in a MongoDB regex.
 */
function escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve every Child this teacher is responsible for, robustly.
 *
 * Child.leadTeacher is a free-form string (the teacher's name as it was typed
 * when the child record was created), so the legacy
 * `Child.find({ leadTeacher: teacher.name })` query silently returns 0 hits
 * whenever the value has drifted by case or whitespace — and in the Record
 * Activity / Classroom Upload flows that drop-out is what makes a teacher's
 * recording fail to appear on any child's data page.
 *
 * To make the fan-out resilient we look up children via three signals and
 * union the results (deduped by ObjectId):
 *
 *   1. Exact match on Child.leadTeacher === teacher.name (fast path; uses index).
 *   2. Case-insensitive, whitespace-trimmed regex match on Child.leadTeacher
 *      (catches "  Jane Doe  " vs "jane doe" / "Jane Doe" cosmetic drift).
 *   3. Active AccessGrant rows where AccessGrant.teacherId === teacher._id
 *      (post-invite link that survives name changes).
 *
 * @param {{ _id?: any, name?: string }} teacher
 * @returns {Promise<Array>} Child documents
 */
export async function getSupervisedChildrenForTeacher(teacher) {
    const childMap = new Map();
    const rawName = teacher?.name;
    const trimmedName = typeof rawName === "string" ? rawName.trim() : "";

    if (trimmedName) {
        const exact = await Child.find({ leadTeacher: trimmedName });
        for (const c of exact) {
            if (c?._id) childMap.set(String(c._id), c);
        }

        const escaped = escapeRegex(trimmedName);
        const loose = await Child.find({
            leadTeacher: { $regex: `^\\s*${escaped}\\s*$`, $options: "i" },
        });
        for (const c of loose) {
            if (c?._id) childMap.set(String(c._id), c);
        }
    }

    if (teacher?._id) {
        const grants = await AccessGrant.find({
            teacherId: teacher._id,
            status: "active",
        })
            .select("childId")
            .lean();
        const grantChildIds = grants.map((g) => g?.childId).filter(Boolean);
        if (grantChildIds.length > 0) {
            const grantChildren = await Child.find({ _id: { $in: grantChildIds } });
            for (const c of grantChildren) {
                if (c?._id) childMap.set(String(c._id), c);
            }
        }
    }

    return [...childMap.values()];
}
