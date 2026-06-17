import mongoose from "mongoose";
import Classroom from "../models/Classroom.js";
import { Child } from "../models/User.js";

/** Normalize a classroom ref (ObjectId, string id, or `{ _id|id, name? }`). */
export function classroomRefToId(ref) {
    if (ref == null) return null;
    if (typeof ref === "object") {
        const id = ref._id ?? ref.id;
        return id ?? null;
    }
    return ref;
}

/** Collect unique classroom ids from an array of mixed classroom refs. */
export function collectClassroomIds(classroomRefs) {
    const ids = [];
    const seen = new Set();
    for (const ref of classroomRefs || []) {
        const id = classroomRefToId(ref);
        if (!id) continue;
        const key = String(id);
        if (seen.has(key)) continue;
        seen.add(key);
        ids.push(id);
    }
    return ids;
}

/**
 * Load classroom names from the DB for every ref in `classroomRefs`.
 * Never substitutes the raw ObjectId string as the display name.
 */
export async function hydrateClassroomRefs(classroomRefs) {
    const ids = collectClassroomIds(classroomRefs);
    if (ids.length === 0) return [];

    const rooms = await Classroom.find({ _id: { $in: ids } }).select("name").lean();
    const nameById = new Map(
        rooms.map((room) => [String(room._id), room.name?.trim() || "Unknown classroom"])
    );

    return ids.map((id) => ({
        _id: id,
        name: nameById.get(String(id)) || "Unknown classroom",
    }));
}

/**
 * Attach resolved `{ _id, name }` classroom refs onto each child in a list.
 */
export async function hydrateClassroomNamesOnChildren(children) {
    if (!Array.isArray(children) || children.length === 0) return children;

    const allIds = new Set();
    for (const child of children) {
        for (const id of collectClassroomIds(child?.classrooms)) {
            allIds.add(String(id));
        }
    }
    if (allIds.size === 0) return children;

    const rooms = await Classroom.find({
        _id: { $in: [...allIds] },
    })
        .select("name")
        .lean();
    const nameById = new Map(
        rooms.map((room) => [String(room._id), room.name?.trim() || "Unknown classroom"])
    );

    for (const child of children) {
        const ids = collectClassroomIds(child?.classrooms);
        child.classrooms = ids.map((id) => ({
            _id: id,
            name: nameById.get(String(id)) || "Unknown classroom",
        }));
    }
    return children;
}

/**
 * Load every child id enrolled in this classroom by unioning the roster
 * array on the Classroom document (always read unpopulated from the DB) with
 * any Child documents that reference this classroom. Repairs one-way drift
 * where `Child.classrooms` was updated but `Classroom.children` was not.
 */
export async function resolveClassroomRosterChildIds(classroomId) {
    if (!classroomId) return [];

    const rosterDoc = await Classroom.findById(classroomId).select("children").lean();
    const fromRoster = (rosterDoc?.children || []).filter(Boolean);

    const fromChildRefs = await Child.find({ classrooms: classroomId })
        .select("_id")
        .lean();

    const seen = new Set();
    const merged = [];
    for (const id of fromRoster) {
        const key = String(id);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(id);
    }
    for (const child of fromChildRefs) {
        const key = String(child._id);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(child._id);
    }
    return merged;
}

/**
 * Resolve classroom roster ids to child summaries and repair drift between
 * `Classroom.children` and `Child.classrooms` (legacy enrollments or partial writes).
 */
export async function materializeAndSyncClassroomChildren(classroom) {
    if (!classroom?._id) return { summaries: [], childIds: [] };

    const classroomId = classroom._id;
    const mergedChildIds = await resolveClassroomRosterChildIds(classroomId);

    if (mergedChildIds.length === 0) {
        return { summaries: [], childIds: [] };
    }

    await Classroom.updateOne(
        { _id: classroomId },
        { $addToSet: { children: { $each: mergedChildIds } } }
    );

    const children = await Child.find({ _id: { $in: mergedChildIds } })
        .select("name")
        .lean();

    const foundIdSet = new Set(children.map((c) => String(c._id)));
    const staleIds = mergedChildIds.filter((id) => !foundIdSet.has(String(id)));

    if (staleIds.length > 0) {
        await Classroom.updateOne(
            { _id: classroomId },
            { $pull: { children: { $in: staleIds } } }
        );
        await Child.updateMany(
            { _id: { $in: staleIds } },
            { $pull: { classrooms: classroomId } }
        );
    }

    if (children.length > 0) {
        await Child.updateMany(
            { _id: { $in: children.map((c) => c._id) } },
            { $addToSet: { classrooms: classroomId } }
        );
    }

    const summaries = children
        .map((c) => ({ id: c._id, name: c.name }))
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return { summaries, childIds: summaries.map((s) => s.id) };
}

/**
 * Merge classrooms from roster membership (`Classroom.children`) onto a child
 * document and mirror missing refs onto `Child.classrooms`.
 */
export async function enrichChildClassroomsFromRosters(childDoc) {
    if (!childDoc?._id) return childDoc;

    const refIds = collectClassroomIds(childDoc.classrooms);
    const rosterRooms = await Classroom.find({
        $or: [
            { children: childDoc._id },
            ...(refIds.length > 0 ? [{ _id: { $in: refIds } }] : []),
        ],
    })
        .select("name")
        .lean();

    if (rosterRooms.length > 0) {
        await Child.updateOne(
            { _id: childDoc._id },
            { $addToSet: { classrooms: { $each: rosterRooms.map((r) => r._id) } } }
        );
    }

    const mergedIds = collectClassroomIds([
        ...refIds,
        ...rosterRooms.map((r) => r._id),
    ]);
    childDoc.classrooms = await hydrateClassroomRefs(mergedIds);
    return childDoc;
}
