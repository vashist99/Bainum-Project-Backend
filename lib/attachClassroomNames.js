/**
 * Stamp classroom names onto teacher assessment rows without changing classroomId.
 * A row with no classroomId gets classroomName null. A missing classroom
 * document is labeled "Deleted classroom".
 */
export function attachClassroomNames(rows, classrooms) {
    const names = new Map(
        (classrooms || []).map((room) => [String(room._id), room.name ?? ""])
    );
    return (rows || []).map((row) => {
        const raw = row?.classroomId?._id ?? row?.classroomId;
        if (raw == null || raw === "") {
            return { ...row, classroomName: null };
        }
        const key = String(raw);
        if (!names.has(key)) {
            return { ...row, classroomName: "Deleted classroom" };
        }
        return { ...row, classroomName: names.get(key) };
    });
}
