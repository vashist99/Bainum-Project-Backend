export function idOf(value) {
    if (value == null) return "";
    return String(value._id ?? value.id ?? value);
}

export function classroomTeacherIds(classroom) {
    if (!classroom) return [];
    const ids = [];
    const lead = idOf(classroom.teacher);
    const assistant = idOf(classroom.assistantTeacher);
    if (lead) ids.push(lead);
    if (assistant && assistant !== lead) ids.push(assistant);
    return ids;
}

export function classroomHasChild(classroom, childId) {
    const cid = idOf(childId);
    if (!classroom || !cid) return false;
    return (classroom.children || []).some((child) => idOf(child) === cid);
}

export function classroomHasParent(classroom, parentId) {
    const pid = idOf(parentId);
    if (!classroom || !pid) return false;
    return (classroom.parents || []).some((parent) => idOf(parent) === pid);
}

/**
 * Lead wins when the teacher leads any shared classroom. Otherwise assistant.
 * Empty string when they are not a lead or assistant on an eligible room.
 */
export function homeViewerSlot({ teacherId, childId, childParentIds = [], classrooms = [] }) {
    const tid = idOf(teacherId);
    let assistant = false;
    for (const room of classrooms || []) {
        if (
            !teacherEligibleForChildHome({
                teacherId: tid,
                childId,
                childParentIds,
                classrooms: [room],
            })
        ) {
            continue;
        }
        if (idOf(room?.teacher) === tid) return "lead";
        if (idOf(room?.assistantTeacher) === tid) assistant = true;
    }
    return assistant ? "assistant" : "";
}

export function teacherEligibleForChildHome({ teacherId, childId, childParentIds = [], classrooms = [] }) {
    const tid = idOf(teacherId);
    const cid = idOf(childId);
    if (!tid || !cid) return false;
    const parentSet = new Set((childParentIds || []).map(idOf).filter(Boolean));
    return classrooms.some((room) => {
        if (!classroomHasChild(room, cid)) return false;
        if (!classroomTeacherIds(room).includes(tid)) return false;
        return (room.parents || []).some((parent) => parentSet.has(idOf(parent)));
    });
}

export function coachEligibleForClassroom({ coachId, classroom, teacherCoachById = {} }) {
    const cid = idOf(coachId);
    if (!cid || !classroom) return false;
    return classroomTeacherIds(classroom).some(
        (teacherId) => idOf(teacherCoachById[teacherId]) === cid
    );
}

export function coachEligibleForChildHome({
    coachId,
    childId,
    childParentIds = [],
    classrooms = [],
    teacherCoachById = {},
}) {
    const cid = idOf(childId);
    if (!cid) return false;
    const parentSet = new Set((childParentIds || []).map(idOf).filter(Boolean));
    return classrooms.some((room) => {
        if (!classroomHasChild(room, cid)) return false;
        if (!(room.parents || []).some((parent) => parentSet.has(idOf(parent)))) return false;
        return coachEligibleForClassroom({ coachId, classroom: room, teacherCoachById });
    });
}

export function parentEligibleForClassroom({ parentId, classroom }) {
    return classroomHasParent(classroom, parentId);
}

export function chartAccessAllowed({ eligible, revoked }) {
    return Boolean(eligible) && !revoked;
}
