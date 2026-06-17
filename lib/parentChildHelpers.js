import mongoose from "mongoose";
import { Parent, Child, Teacher } from "../models/User.js";
import Classroom from "../models/Classroom.js";
import AccessGrant from "../models/AccessGrant.js";
import { enableEnactRecordingForBainumParent } from "./enactAdminClient.js";

/**
 * After linking a parent to a child (invite acceptance or admin linking),
 * sync any teacher AccessGrants and (when applicable) Enact recording.
 *
 * - Teacher-sent invitations grant the inviting teacher access immediately.
 * - Admin-sent invitations grant every teacher on every classroom the
 *   child is currently enrolled in (lead + assistant). This replaces the
 *   prior "look up the child's leadTeacher by name" heuristic with the
 *   classroom-membership signal, which is now the system of record.
 *
 * @param {{ sentByRole: string, sentBy: import("mongoose").Types.ObjectId, email: string, enactEmailExists?: boolean }} invitation
 */
export async function applyAccessGrantsAndEnactForChild(invitation, parentId, childOid) {
    try {
        if (invitation.sentByRole === "teacher") {
            await AccessGrant.findOneAndUpdate(
                {
                    childId: childOid,
                    teacherId: invitation.sentBy,
                    parentId,
                },
                { $set: { status: "active", initiatedBy: "teacher" } },
                { upsert: true, new: true }
            );
            await syncAccessGrantsForParentTeacherPair(parentId, invitation.sentBy);
        } else if (invitation.sentByRole === "admin") {
            const childDoc = await Child.findById(childOid).select("classrooms");
            const classroomIds = Array.isArray(childDoc?.classrooms) ? childDoc.classrooms : [];
            if (classroomIds.length > 0) {
                const rooms = await Classroom.find({ _id: { $in: classroomIds } })
                    .select("teacher assistantTeacher")
                    .lean();
                const teacherIds = new Set();
                for (const room of rooms) {
                    if (room.teacher) teacherIds.add(String(room.teacher));
                    if (room.assistantTeacher) teacherIds.add(String(room.assistantTeacher));
                }
                for (const tid of teacherIds) {
                    await AccessGrant.findOneAndUpdate(
                        {
                            childId: childOid,
                            teacherId: new mongoose.Types.ObjectId(tid),
                            parentId,
                        },
                        { $set: { status: "active", initiatedBy: "teacher" } },
                        { upsert: true, new: true }
                    );
                    await syncAccessGrantsForParentTeacherPair(parentId, new mongoose.Types.ObjectId(tid));
                }
            }
            // If the child is not enrolled in any classroom yet, no automatic
            // grants are created here — the parent gets access to their child;
            // teacher access materializes when the child is added to a classroom.
        }
    } catch (grantErr) {
        console.error("AccessGrant on parent link:", grantErr.message);
    }
    if (invitation.enactEmailExists === true) {
        void enableEnactRecordingForBainumParent({
            email: invitation.email,
            baniumChildId: childOid.toString(),
        });
    }
}

/**
 * @param {import("mongoose").Document | object} parent
 * @returns {string[]}
 */
/**
 * One parent account may be linked to a child via invitation acceptance (first accept wins).
 * Child.parents uses $addToSet so the same parent id is never duplicated; this guard prevents a second account.
 *
 * @param {import("mongoose").Document|object|null|undefined} child Child doc with `parents` array
 * @param {import("mongoose").Types.ObjectId|null|undefined} registeringParentId Parent registering (existing account), or null for brand-new account
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function guardSingleParentInviteAcceptance(child, registeringParentId) {
    if (!child) {
        return { ok: false, message: "Child not found" };
    }
    const parents = child.parents || [];
    if (parents.length === 0) {
        return { ok: true };
    }
    const regStr = registeringParentId != null ? String(registeringParentId) : null;
    if (regStr && parents.some((p) => String(p) === regStr)) {
        return { ok: true };
    }
    return {
        ok: false,
        message:
            "This child already has a linked parent account. Only one parent may accept an invitation for this child.",
    };
}

export function mergeChildIdsFromParentDoc(parent) {
    const set = new Set();
    if (parent?.childIds?.length) {
        for (const id of parent.childIds) {
            if (id) set.add(id.toString());
        }
    }
    if (parent?.childId) {
        set.add(parent.childId.toString());
    }
    return [...set];
}

/**
 * All child ids for this parent: childIds + legacy childId + Child.parents back-links.
 * @param {import("mongoose").Document | object} parent
 * @returns {Promise<string[]>}
 */
export async function getResolvedChildIdStringsForParent(parent) {
    const merged = new Set(mergeChildIdsFromParentDoc(parent));
    if (parent?._id) {
        const linked = await Child.find({ parents: parent._id }).select("_id").lean();
        for (const c of linked) {
            if (c?._id) merged.add(c._id.toString());
        }
    }
    return [...merged];
}

/**
 * @param {import("mongoose").Document | object} parent
 * @param {string|mongoose.Types.ObjectId} childId
 */
export async function parentMayAccessChild(parent, childId) {
    if (!parent?.invitationAccepted) return false;
    const allowed = await getResolvedChildIdStringsForParent(parent);
    return allowed.includes(String(childId));
}

/**
 * JWT payload fields for a parent (includes legacy childId = first child for old clients).
 * @param {import("mongoose").Document | object} parent
 */
export function buildParentJwtPayload(parent) {
    const ids = mergeChildIdsFromParentDoc(parent);
    const primary = ids[0] || (parent.childId && parent.childId.toString());
    const payload = {
        id: parent._id.toString(),
        name: parent.name,
        email: parent.email,
        username: parent.username,
        role: "parent",
        childIds: ids,
    };
    if (primary) {
        payload.childId = primary;
    }
    return payload;
}

/**
 * Keep childId + childIds in sync on the parent document.
 * @param {import("mongoose").Document} parent
 */
export function normalizeParentChildReferences(parent) {
    const ids = mergeChildIdsFromParentDoc(parent);
    parent.childIds = ids.map((s) => new mongoose.Types.ObjectId(s));
    if (ids.length > 0) {
        parent.childId = new mongoose.Types.ObjectId(ids[0]);
    }
}

/**
 * After invitation acceptance: ensure an active AccessGrant for every
 * (parent, teacher, child) triple where the teacher supervises one of
 * the parent's children via classroom membership (lead OR assistant on
 * any classroom the child is enrolled in).
 *
 * Replaces the prior leadTeacher-name match. Idempotent: re-running
 * upserts the same grants without duplication.
 *
 * @param {mongoose.Types.ObjectId} parentId
 * @param {mongoose.Types.ObjectId} teacherId
 */
export async function syncAccessGrantsForParentTeacherPair(parentId, teacherId) {
    const parent = await Parent.findById(parentId);
    if (!parent) return;
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) return;
    const childIdStrs = await getResolvedChildIdStringsForParent(parent);
    if (childIdStrs.length === 0) return;

    const supervisedRooms = await Classroom.find({
        $or: [{ teacher: teacher._id }, { assistantTeacher: teacher._id }],
    })
        .select("children")
        .lean();
    const supervisedChildIds = new Set(
        supervisedRooms.flatMap((r) => (r.children || []).map(String))
    );

    for (const cid of childIdStrs) {
        if (!supervisedChildIds.has(String(cid))) continue;
        await AccessGrant.findOneAndUpdate(
            {
                childId: cid,
                teacherId,
                parentId,
            },
            { $set: { status: "active", initiatedBy: "teacher" } },
            { upsert: true, new: true }
        );
    }
}
