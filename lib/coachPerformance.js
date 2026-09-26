function idOf(value) {
    if (value == null || value === "") return "";
    return String(value._id ?? value.id ?? value);
}

/**
 * Admin, or the coach whose id is requested. Everyone else is denied.
 */
export function coachPerformanceAccess(user, coachId) {
    const role = user?.role;
    if (role === "admin") return true;
    if (role === "coach" && idOf(user) && idOf(user) === String(coachId)) return true;
    return false;
}

function classroomIdsForTeachers(classrooms, assignedTeacherIds) {
    const teachers = new Set((assignedTeacherIds || []).map((id) => String(id)));
    const rooms = new Set();
    for (const room of classrooms || []) {
        const lead = idOf(room?.teacher);
        const assistant = idOf(room?.assistantTeacher);
        if (teachers.has(lead) || teachers.has(assistant)) {
            const roomId = idOf(room);
            if (roomId) rooms.add(roomId);
        }
    }
    return rooms;
}

function chartRow(row) {
    return {
        date: row?.date ?? null,
        wordsPerMinute: row?.wordsPerMinute ?? null,
        wordCount: row?.wordCount ?? null,
        categoryWPM: row?.categoryWPM ?? null,
        categoryWordCount: row?.categoryWordCount ?? null,
    };
}

/**
 * Classroom recordings stored under assigned teachers, in classrooms those
 * teachers lead or assist. Grants are not consulted. Transcript text is dropped.
 */
export function selectCoachPerformanceRows({ assignedTeacherIds, classrooms, assessments }) {
    const teachers = new Set((assignedTeacherIds || []).map((id) => String(id)));
    const rooms = classroomIdsForTeachers(classrooms, assignedTeacherIds);
    const rows = [];
    for (const row of assessments || []) {
        if (row?.hidden) continue;
        if (row?.activityContext === "home") continue;
        const teacherId = idOf(row?.teacherId);
        if (!teachers.has(teacherId)) continue;
        const classroomId = idOf(row?.classroomId);
        if (!classroomId || !rooms.has(classroomId)) continue;
        rows.push(chartRow(row));
    }
    return rows;
}
