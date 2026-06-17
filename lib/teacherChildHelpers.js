import { Child } from "../models/User.js";
import Classroom from "../models/Classroom.js";
import AccessGrant from "../models/AccessGrant.js";

/**
 * Resolve every Child this teacher is responsible for, robustly.
 *
 * Source of truth for "this teacher supervises this child" is classroom
 * membership: a teacher supervises a child whenever the teacher is the
 * lead or assistant on at least one classroom the child is enrolled in.
 *
 * To keep the legacy access-grant story working (a teacher with an
 * active AccessGrant retains visibility even if they're no longer on a
 * classroom with that child), we union in any AccessGrant-derived
 * children too. Results are deduped by ObjectId.
 *
 * The prior implementation matched on Child.leadTeacher as a free-form
 * name string and broke whenever cosmetic drift (case/whitespace) crept
 * in; that field is gone from the schema as of this release. If you're
 * looking for it in legacy data, query the raw `children` collection in
 * a one-shot script — mongoose strict mode hides it from the app.
 *
 * @param {{ _id?: any }} teacher
 * @returns {Promise<Array>} Child documents
 */
export async function getSupervisedChildrenForTeacher(teacher) {
    const teacherId = teacher?._id;
    if (!teacherId) return [];

    const childMap = new Map();

    const rooms = await Classroom.find({
        $or: [{ teacher: teacherId }, { assistantTeacher: teacherId }],
    })
        .select("children")
        .lean();

    const classroomChildIds = new Set(
        rooms.flatMap((r) => (r.children || []).map(String))
    );

    const roomIds = rooms.map((r) => r._id).filter(Boolean);
    if (roomIds.length > 0) {
        const fromChildRefs = await Child.find({ classrooms: { $in: roomIds } })
            .select("_id")
            .lean();
        for (const child of fromChildRefs) {
            if (child?._id) classroomChildIds.add(String(child._id));
        }
    }

    const grants = await AccessGrant.find({
        teacherId,
        status: "active",
    })
        .select("childId")
        .lean();
    for (const g of grants) {
        if (g?.childId) classroomChildIds.add(String(g.childId));
    }

    if (classroomChildIds.size === 0) return [];

    const children = await Child.find({ _id: { $in: [...classroomChildIds] } }).populate(
        "classrooms",
        "name"
    );
    for (const c of children) {
        if (c?._id) childMap.set(String(c._id), c);
    }
    return [...childMap.values()];
}
