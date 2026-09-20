import { Teacher } from "../models/User.js";
import TeacherInvitation from "../models/TeacherInvitation.js";

export const COACH_TEACHER_SLOT_LIMIT = 20;

/**
 * Assigned teachers plus this coach's still-pending invites whose email
 * is not already on the assigned roster (re-invites do not consume a
 * second slot).
 */
export function countCoachTeacherSlots({ assigned = [], pending = [] }) {
    const assignedEmails = new Set(
        assigned
            .map((row) => String(row.email || row).toLowerCase().trim())
            .filter(Boolean)
    );
    const extraPending = pending.filter((row) => {
        const email = String(row.email || row).toLowerCase().trim();
        return email && !assignedEmails.has(email);
    });
    return assignedEmails.size + extraPending.length;
}

export async function coachTeacherSlotCount(coachId) {
    const assigned = await Teacher.find({ coachId }).select("email").lean();
    const pending = await TeacherInvitation.find({
        sentBy: coachId,
        sentByRole: "coach",
        status: "pending",
        expiresAt: { $gt: new Date() },
    })
        .select("email")
        .lean();
    return countCoachTeacherSlots({ assigned, pending });
}
