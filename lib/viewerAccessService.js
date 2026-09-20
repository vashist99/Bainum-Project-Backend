import Classroom from "../models/Classroom.js";
import HomeViewGrant from "../models/HomeViewGrant.js";
import CoachClassroomGrant from "../models/CoachClassroomGrant.js";
import ParentClassroomGrant from "../models/ParentClassroomGrant.js";
import { Child, Teacher } from "../models/User.js";
import {
    chartAccessAllowed,
    classroomTeacherIds,
    coachEligibleForChildHome,
    coachEligibleForClassroom,
    idOf,
    teacherEligibleForChildHome,
} from "./viewerEligibility.js";

async function loadChildContext(childId) {
    const child = await Child.findById(childId).select("parents classrooms").lean();
    if (!child) return null;
    const classrooms = await Classroom.find({
        $or: [{ _id: { $in: child.classrooms || [] } }, { children: childId }],
    })
        .select("teacher assistantTeacher children parents")
        .lean();
    const teacherIds = [...new Set(classrooms.flatMap((room) => classroomTeacherIds(room)))];
    const teachers = teacherIds.length
        ? await Teacher.find({ _id: { $in: teacherIds } }).select("coachId").lean()
        : [];
    const teacherCoachById = {};
    for (const teacher of teachers) {
        teacherCoachById[idOf(teacher)] = teacher.coachId ? idOf(teacher.coachId) : "";
    }
    return {
        child,
        childParentIds: (child.parents || []).map(idOf).filter(Boolean),
        classrooms,
        teacherCoachById,
    };
}

export async function isTeacherEligibleForChildHome(teacherId, childId) {
    const ctx = await loadChildContext(childId);
    if (!ctx) return false;
    return teacherEligibleForChildHome({
        teacherId,
        childId,
        childParentIds: ctx.childParentIds,
        classrooms: ctx.classrooms,
    });
}

export async function isCoachEligibleForChildHome(coachId, childId) {
    const ctx = await loadChildContext(childId);
    if (!ctx) return false;
    return coachEligibleForChildHome({
        coachId,
        childId,
        childParentIds: ctx.childParentIds,
        classrooms: ctx.classrooms,
        teacherCoachById: ctx.teacherCoachById,
    });
}

export async function isCoachEligibleForClassroom(coachId, classroom) {
    if (!classroom) return false;
    const teacherIds = classroomTeacherIds(classroom);
    if (teacherIds.length === 0) return false;
    const teachers = await Teacher.find({ _id: { $in: teacherIds } }).select("coachId").lean();
    const teacherCoachById = {};
    for (const teacher of teachers) {
        teacherCoachById[idOf(teacher)] = teacher.coachId ? idOf(teacher.coachId) : "";
    }
    return coachEligibleForClassroom({ coachId, classroom, teacherCoachById });
}

export async function isParentClassroomRevoked(parentId, classroomId) {
    const grant = await ParentClassroomGrant.findOne({ parentId, classroomId }).lean();
    return grant?.status === "revoked";
}

export async function isHomeViewerRevoked(granteeId, childId) {
    const grant = await HomeViewGrant.findOne({
        childId,
        scope: "user",
        granteeId,
        status: "revoked",
    }).lean();
    return !!grant;
}

export async function hasActiveHomeGrant(userId, childId) {
    return !!(await HomeViewGrant.exists({
        childId,
        status: "active",
        $or: [{ scope: "all-staff" }, { scope: "user", granteeId: userId }],
    }));
}

export async function ensureCoachClassroomGrant(coachId, classroomId) {
    let grant = await CoachClassroomGrant.findOne({ coachId, classroomId });
    if (!grant) {
        grant = await CoachClassroomGrant.create({
            coachId,
            classroomId,
            status: "active",
        });
        return grant;
    }
    if (grant.status === "pending") {
        grant.status = "active";
        await grant.save();
    }
    return grant;
}

export async function resolveCoachClassroomAccess(coachId, classroom) {
    const eligible = await isCoachEligibleForClassroom(coachId, classroom);
    if (!eligible) {
        return { allowed: false, grant: null, transcript: false };
    }
    let grant = await CoachClassroomGrant.findOne({
        coachId,
        classroomId: idOf(classroom),
    });
    if (grant?.status === "revoked") {
        return { allowed: false, grant, transcript: false };
    }
    if (!grant || grant.status === "pending") {
        grant = await ensureCoachClassroomGrant(coachId, idOf(classroom));
    }
    return {
        allowed: true,
        grant,
        transcript: !!grant.transcriptAccess,
    };
}

export async function resolveParentClassroomAccess(parentId, classroom) {
    const enrolled = (classroom.parents || []).some((parent) => idOf(parent) === idOf(parentId));
    if (!enrolled) return { allowed: false };
    const revoked = await isParentClassroomRevoked(parentId, idOf(classroom));
    return { allowed: chartAccessAllowed({ eligible: true, revoked }) };
}

export async function canViewerSeeHomeCharts(user, childId) {
    if (!user?.id || !childId) return false;
    if (user.role === "admin") return true;
    if (user.role === "parent") return true;
    if (user.role !== "teacher" && user.role !== "coach") return false;
    if (await isHomeViewerRevoked(user.id, childId)) return false;
    if (await hasActiveHomeGrant(user.id, childId)) return true;
    if (user.role === "teacher") return isTeacherEligibleForChildHome(user.id, childId);
    return isCoachEligibleForChildHome(user.id, childId);
}

export async function canViewerSeeHomeTranscripts(user, childId) {
    if (!user?.id || !childId) return false;
    if (user.role === "admin") return true;
    if (user.role === "parent") return true;
    if (!(await canViewerSeeHomeCharts(user, childId))) return false;
    return !!(await HomeViewGrant.exists({
        childId,
        status: "active",
        transcriptAccess: true,
        $or: [{ scope: "all-staff" }, { scope: "user", granteeId: user.id }],
    }));
}

export async function listEligibleHomeViewers(childId) {
    const ctx = await loadChildContext(childId);
    if (!ctx) return { teachers: [], coaches: [], parentIds: ctx?.childParentIds || [] };
    const teacherIds = [...new Set(ctx.classrooms.flatMap((room) => classroomTeacherIds(room)))];
    const teachers = [];
    const coachIds = new Set();
    for (const teacherId of teacherIds) {
        if (
            teacherEligibleForChildHome({
                teacherId,
                childId,
                childParentIds: ctx.childParentIds,
                classrooms: ctx.classrooms,
            })
        ) {
            teachers.push(teacherId);
            const coachId = ctx.teacherCoachById[teacherId];
            if (coachId) coachIds.add(coachId);
        }
    }
    return {
        teachers,
        coaches: [...coachIds],
        parentIds: ctx.childParentIds,
    };
}

export async function listEligibleClassroomViewers(classroom) {
    const parentIds = (classroom.parents || []).map(idOf).filter(Boolean);
    const teacherIds = classroomTeacherIds(classroom);
    const teachers = teacherIds.length
        ? await Teacher.find({ _id: { $in: teacherIds } }).select("coachId").lean()
        : [];
    const coachIds = [
        ...new Set(teachers.map((teacher) => (teacher.coachId ? idOf(teacher.coachId) : "")).filter(Boolean)),
    ];
    return {
        parentIds,
        teacherIds,
        coachIds,
        leadId: idOf(classroom.teacher),
        assistantId: idOf(classroom.assistantTeacher),
    };
}

async function upsertActiveIfNotRevoked(Model, filter, createFields) {
    const existing = await Model.findOne(filter);
    if (existing?.status === "revoked") return existing;
    if (existing) {
        if (existing.status === "pending") {
            existing.status = "active";
            await existing.save();
        }
        return existing;
    }
    try {
        return await Model.create({ ...filter, ...createFields, status: "active" });
    } catch (error) {
        if (error?.code === 11000) return Model.findOne(filter);
        throw error;
    }
}

async function syncClassroomEligibility(classroomId) {
    const classroom = await Classroom.findById(classroomId)
        .select("teacher assistantTeacher parents children")
        .lean();
    if (!classroom) return;
    for (const parentId of classroom.parents || []) {
        await upsertActiveIfNotRevoked(
            ParentClassroomGrant,
            { parentId, classroomId },
            {}
        );
    }
    const eligible = await listEligibleClassroomViewers(classroom);
    for (const coachId of eligible.coachIds) {
        await upsertActiveIfNotRevoked(
            CoachClassroomGrant,
            { coachId, classroomId },
            { transcriptAccess: false }
        );
    }
    for (const childId of classroom.children || []) {
        const homeEligible = await listEligibleHomeViewers(childId);
        for (const teacherId of homeEligible.teachers) {
            await upsertActiveIfNotRevoked(
                HomeViewGrant,
                { childId, scope: "user", granteeId: teacherId },
                { granteeRole: "teacher", initiatedBy: "system", transcriptAccess: false }
            );
        }
        for (const coachId of homeEligible.coaches) {
            await upsertActiveIfNotRevoked(
                HomeViewGrant,
                { childId, scope: "user", granteeId: coachId },
                { granteeRole: "coach", initiatedBy: "system", transcriptAccess: false }
            );
        }
    }
}

/**
 * Create missing active grants for newly eligible pairs. Never deletes
 * or overwrites a revoked row — unenroll/unassign only hides via eligibility.
 */
export async function syncViewerEligibility({ classroomId, teacherId } = {}) {
    const ids = new Set();
    if (classroomId) ids.add(String(classroomId));
    if (teacherId) {
        const rooms = await Classroom.find({
            $or: [{ teacher: teacherId }, { assistantTeacher: teacherId }],
        })
            .select("_id")
            .lean();
        for (const room of rooms) ids.add(String(room._id));
    }
    for (const id of ids) {
        await syncClassroomEligibility(id);
    }
    return { ok: true, classroomCount: ids.size };
}
