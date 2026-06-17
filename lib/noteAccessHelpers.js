import mongoose from "mongoose";
import { Child, Parent } from "../models/User.js";
import Classroom from "../models/Classroom.js";
import { hasActiveTeacherChildGrant } from "./accessGrantHelpers.js";
import { parentMayAccessChild } from "./parentChildHelpers.js";
import { canManageClassroom } from "./classroomHelpers.js";

function idOf(value) {
    if (value == null) return "";
    return String(value._id ?? value.id ?? value);
}

export function parseNoteScope(body) {
    const childId = body?.childId;
    const classroomId = body?.classroomId;
    const hasChild = childId != null && String(childId).trim() !== "";
    const hasClassroom = classroomId != null && String(classroomId).trim() !== "";
    if (hasChild && hasClassroom) {
        return { ok: false, message: "Provide childId or classroomId, not both" };
    }
    if (!hasChild && !hasClassroom) {
        return { ok: false, message: "childId or classroomId is required" };
    }
    if (hasChild && !mongoose.Types.ObjectId.isValid(childId)) {
        return { ok: false, message: "Invalid child id" };
    }
    if (hasClassroom && !mongoose.Types.ObjectId.isValid(classroomId)) {
        return { ok: false, message: "Invalid classroom id" };
    }
    return {
        ok: true,
        childId: hasChild ? childId : null,
        classroomId: hasClassroom ? classroomId : null,
    };
}

async function teacherMayAccessChild(userId, childId) {
    if (await hasActiveTeacherChildGrant(userId, childId)) return true;
    const child = await Child.findById(childId).select("classrooms").lean();
    if (!child?.classrooms?.length) return false;
    const supervised = await Classroom.exists({
        _id: { $in: child.classrooms },
        $or: [{ teacher: userId }, { assistantTeacher: userId }],
    });
    return !!supervised;
}

export { teacherMayAccessChild };

export async function canReadChildNotes(user, childId) {
    if (!user?.id) return false;
    if (user.role === "admin") return true;
    if (user.role === "parent") {
        const parent = await Parent.findById(user.id);
        if (!parent) return false;
        return await parentMayAccessChild(parent, childId);
    }
    if (user.role === "teacher") {
        return await teacherMayAccessChild(user.id, childId);
    }
    return false;
}

export async function canWriteChildNotes(user, childId) {
    return canReadChildNotes(user, childId);
}

function parentEnrolledInClassroom(userId, classroom) {
    const uid = String(userId);
    return (classroom?.parents || []).some((p) => idOf(p) === uid);
}

export async function canReadClassroomNotes(user, classroom) {
    if (!user?.id || !classroom) return false;
    if (user.role === "admin") return true;
    if (canManageClassroom(user, classroom)) return true;
    if (user.role === "parent") {
        return parentEnrolledInClassroom(user.id, classroom);
    }
    return false;
}

export async function canWriteClassroomNotes(user, classroom) {
    if (!user?.id || !classroom) return false;
    if (user.role === "admin") return true;
    return canManageClassroom(user, classroom);
}

export async function loadClassroomForNoteAccess(classroomId) {
    if (!mongoose.Types.ObjectId.isValid(classroomId)) return null;
    return Classroom.findById(classroomId).select("teacher assistantTeacher parents name");
}

export async function findParentsLinkedToChild(childId) {
    const child = await Child.findById(childId).select("parents name").lean();
    if (!child) return { child: null, parents: [] };
    const parentIds = new Set((child.parents || []).map((p) => idOf(p)).filter(Boolean));
    const extra = await Parent.find({ childIds: childId }).select("_id").lean();
    for (const p of extra) {
        if (p?._id) parentIds.add(String(p._id));
    }
    const parents = await Parent.find({ _id: { $in: [...parentIds] } })
        .select("_id")
        .lean();
    return { child, parents };
}
