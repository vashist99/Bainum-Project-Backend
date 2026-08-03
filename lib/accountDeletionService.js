import { Teacher, Coach } from "../models/User.js";
import Classroom from "../models/Classroom.js";
import AccessGrant from "../models/AccessGrant.js";
import HomeViewGrant from "../models/HomeViewGrant.js";
import CoachClassroomGrant from "../models/CoachClassroomGrant.js";
import Notification from "../models/Notification.js";
import PasswordReset from "../models/PasswordReset.js";
import { logActivity } from "./activityLogService.js";

/**
 * Self-service account deletion (teachers and coaches).
 *
 * Contract (see openspec account-deletion spec):
 * - Classroom talk data is PRESERVED: TeacherAssessment rows are never
 *   touched (display uses the denormalized `uploadedBy` name), and
 *   classrooms survive with their lead/assistant slot cleared.
 * - Personal artifacts (grants, notifications, password resets, coach
 *   assignments) are removed.
 * - ActivityLog rows are preserved (`actorName` is denormalized); an
 *   `account-deleted` entry is written BEFORE the document delete so the
 *   row can still be created for the (about-to-vanish) actor.
 */

export async function deleteTeacherAccount(teacherId) {
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) return { deleted: false, reason: "not-found" };

    await logActivity({
        actor: { id: teacher._id, role: "teacher", name: teacher.name },
        action: "account-deleted",
        targetType: "profile",
        targetId: teacher._id,
        targetLabel: teacher.name,
        detail: "Deleted their account (classroom data preserved)",
    });

    // Classrooms survive; only the staffing slots are cleared.
    await Classroom.updateMany({ teacher: teacher._id }, { $set: { teacher: null } });
    await Classroom.updateMany(
        { assistantTeacher: teacher._id },
        { $set: { assistantTeacher: null } }
    );

    await AccessGrant.deleteMany({ teacherId: teacher._id });
    await HomeViewGrant.deleteMany({ scope: "user", granteeId: teacher._id });
    await Notification.deleteMany({ recipientId: teacher._id });
    await PasswordReset.deleteMany({ email: teacher.email });

    await Teacher.deleteOne({ _id: teacher._id });
    return { deleted: true };
}

export async function deleteCoachAccount(coachId) {
    const coach = await Coach.findById(coachId);
    if (!coach) return { deleted: false, reason: "not-found" };

    await logActivity({
        actor: { id: coach._id, role: "coach", name: coach.name },
        action: "account-deleted",
        targetType: "profile",
        targetId: coach._id,
        targetLabel: coach.name,
        detail: "Deleted their account (classroom data preserved)",
    });

    await CoachClassroomGrant.deleteMany({ coachId: coach._id });
    await Teacher.updateMany({ coachId: coach._id }, { $set: { coachId: null } });
    await Notification.deleteMany({ recipientId: coach._id });
    await PasswordReset.deleteMany({ email: coach.email });

    await Coach.deleteOne({ _id: coach._id });
    return { deleted: true };
}
