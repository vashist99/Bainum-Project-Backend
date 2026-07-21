import mongoose from "mongoose";
import { Coach, Teacher } from "../models/User.js";
import Classroom from "../models/Classroom.js";
import CoachClassroomGrant from "../models/CoachClassroomGrant.js";
import { createCoachGrantNotification } from "../lib/notificationService.js";
import { coachClassroomTier } from "../lib/permissions.js";

function isValidId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Classrooms a coach can reach through their assigned teachers: any room
 * where an assigned teacher is the lead or the assistant.
 */
async function classroomsInCoachScope(coachId) {
    const teachers = await Teacher.find({ coachId }).select("_id name center");
    const teacherIds = teachers.map((t) => t._id);
    const classrooms = await Classroom.find({
        $or: [{ teacher: { $in: teacherIds } }, { assistantTeacher: { $in: teacherIds } }],
    })
        .populate("teacher", "name center coachId")
        .populate("assistantTeacher", "name center coachId");
    return { teachers, classrooms };
}

/**
 * Revoke a coach's grants that are no longer qualified by any assigned
 * teacher. Called after unassignment/reassignment.
 */
async function revokeUnqualifiedGrants(coachId) {
    const { classrooms } = await classroomsInCoachScope(coachId);
    const inScopeIds = new Set(classrooms.map((c) => String(c._id)));
    const grants = await CoachClassroomGrant.find({
        coachId,
        status: { $in: ["pending", "active"] },
    });
    const revoked = [];
    for (const grant of grants) {
        if (!inScopeIds.has(String(grant.classroomId))) {
            grant.status = "revoked";
            grant.transcriptAccess = false;
            await grant.save();
            revoked.push(grant);
        }
    }
    return revoked;
}

/** GET /api/coaches — admin list with assignment + grant summaries. */
export const listCoaches = async (req, res) => {
    try {
        const coaches = await Coach.find({}).select("name email username createdAt");
        const coachIds = coaches.map((c) => c._id);
        const teachers = await Teacher.find({ coachId: { $in: coachIds } }).select("name email center coachId");
        const grants = await CoachClassroomGrant.find({ coachId: { $in: coachIds } })
            .populate("classroomId", "name center");

        const byCoach = coaches.map((coach) => {
            const cid = String(coach._id);
            const assignedTeachers = teachers.filter((t) => String(t.coachId) === cid);
            const coachGrants = grants.filter((g) => String(g.coachId) === cid);
            return {
                id: coach._id,
                name: coach.name,
                email: coach.email,
                username: coach.username,
                createdAt: coach.createdAt,
                assignedTeachers: assignedTeachers.map((t) => ({
                    id: t._id,
                    name: t.name,
                    email: t.email,
                    center: t.center,
                })),
                grants: coachGrants.map((g) => ({
                    id: g._id,
                    classroomId: g.classroomId?._id ?? g.classroomId,
                    classroomName: g.classroomId?.name ?? "",
                    status: g.status,
                    transcriptAccess: g.transcriptAccess,
                    requestedAt: g.requestedAt,
                })),
            };
        });

        res.status(200).json({ coaches: byCoach });
    } catch (error) {
        console.error("Error listing coaches:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/** POST /api/coaches/:coachId/teachers/:teacherId — admin assigns a teacher. */
export const assignTeacherToCoach = async (req, res) => {
    try {
        const { coachId, teacherId } = req.params;
        if (!isValidId(coachId) || !isValidId(teacherId)) {
            return res.status(400).json({ message: "Invalid coach or teacher id" });
        }
        const coach = await Coach.findById(coachId);
        if (!coach) return res.status(404).json({ message: "Coach not found" });
        const teacher = await Teacher.findById(teacherId);
        if (!teacher) return res.status(404).json({ message: "Teacher not found" });

        const previousCoachId = teacher.coachId ? String(teacher.coachId) : null;
        if (previousCoachId === String(coachId)) {
            return res.status(200).json({ message: "Teacher already assigned to this coach", changed: false });
        }
        // Reassignment must be explicit: the UI confirms, the API requires the flag.
        if (previousCoachId && req.body?.confirmReassign !== true) {
            return res.status(409).json({
                message: "Teacher is already assigned to another coach. Confirm reassignment.",
                requiresConfirmation: true,
            });
        }

        teacher.coachId = coach._id;
        await teacher.save();

        if (previousCoachId) {
            await revokeUnqualifiedGrants(previousCoachId);
        }

        res.status(200).json({ message: "Teacher assigned", changed: true });
    } catch (error) {
        console.error("Error assigning teacher to coach:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/** DELETE /api/coaches/:coachId/teachers/:teacherId — admin unassigns a teacher. */
export const unassignTeacherFromCoach = async (req, res) => {
    try {
        const { coachId, teacherId } = req.params;
        if (!isValidId(coachId) || !isValidId(teacherId)) {
            return res.status(400).json({ message: "Invalid coach or teacher id" });
        }
        const teacher = await Teacher.findById(teacherId);
        if (!teacher) return res.status(404).json({ message: "Teacher not found" });
        if (String(teacher.coachId) !== String(coachId)) {
            return res.status(400).json({ message: "Teacher is not assigned to this coach" });
        }

        teacher.coachId = null;
        await teacher.save();

        const revoked = await revokeUnqualifiedGrants(coachId);
        for (const grant of revoked) {
            const classroom = await Classroom.findById(grant.classroomId).select("name");
            await createCoachGrantNotification({
                recipientId: coachId,
                recipientRole: "coach",
                type: "coach-access-revoked",
                classroom,
                message: `Your access to classroom "${classroom?.name ?? ""}" was revoked (teacher unassigned)`,
            });
        }

        res.status(200).json({ message: "Teacher unassigned", revokedGrants: revoked.length });
    } catch (error) {
        console.error("Error unassigning teacher from coach:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/**
 * GET /api/coaches/me/overview — the coach dashboard payload: assigned
 * teachers, their classrooms, and this coach's access tier per classroom.
 */
export const getCoachOverview = async (req, res) => {
    try {
        const coachId = req.user.id;
        const { teachers, classrooms } = await classroomsInCoachScope(coachId);

        const rows = [];
        for (const classroom of classrooms) {
            const tier = await coachClassroomTier(coachId, classroom._id);
            rows.push({
                id: classroom._id,
                name: classroom.name,
                center: classroom.center,
                leadTeacher: classroom.teacher
                    ? { id: classroom.teacher._id, name: classroom.teacher.name }
                    : null,
                assistantTeacher: classroom.assistantTeacher
                    ? { id: classroom.assistantTeacher._id, name: classroom.assistantTeacher.name }
                    : null,
                accessTier: tier,
            });
        }

        res.status(200).json({
            teachers: teachers.map((t) => ({ id: t._id, name: t.name, center: t.center })),
            classrooms: rows,
        });
    } catch (error) {
        console.error("Error building coach overview:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/** POST /api/coaches/grants/request — coach requests classroom access. */
export const requestClassroomAccess = async (req, res) => {
    try {
        const coachId = req.user.id;
        const { classroomId } = req.body || {};
        if (!isValidId(classroomId)) {
            return res.status(400).json({ message: "Invalid classroom id" });
        }

        // Scope guard: classroom's lead or assistant must be an assigned teacher.
        const classroom = await Classroom.findById(classroomId)
            .populate("teacher", "name coachId")
            .populate("assistantTeacher", "name coachId");
        if (!classroom) return res.status(404).json({ message: "Classroom not found" });
        const qualifies =
            String(classroom.teacher?.coachId) === String(coachId) ||
            String(classroom.assistantTeacher?.coachId) === String(coachId);
        if (!qualifies) {
            return res.status(403).json({
                message: "You can only request classrooms of teachers assigned to you",
            });
        }

        // Idempotent: return the existing pending/active grant untouched.
        const existing = await CoachClassroomGrant.findOne({ coachId, classroomId });
        if (existing && existing.status !== "revoked") {
            return res.status(200).json({
                message: existing.status === "pending" ? "Request already pending" : "Access already granted",
                grant: existing,
                created: false,
            });
        }

        let grant;
        if (existing) {
            existing.status = "pending";
            existing.transcriptAccess = false;
            existing.requestedAt = new Date();
            existing.decidedBy = undefined;
            existing.decidedByRole = undefined;
            grant = await existing.save();
        } else {
            grant = await CoachClassroomGrant.create({ coachId, classroomId, status: "pending" });
        }

        const coach = await Coach.findById(coachId).select("name");
        await createCoachGrantNotification({
            recipientId: classroom.teacher?._id,
            recipientRole: "teacher",
            type: "coach-access-requested",
            classroom,
            message: `Coach ${coach?.name ?? ""} requested access to classroom "${classroom.name}"`,
        });

        res.status(201).json({ message: "Access requested", grant, created: true });
    } catch (error) {
        console.error("Error requesting classroom access:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

async function loadGrantWithClassroom(grantId, res) {
    if (!isValidId(grantId)) {
        res.status(400).json({ message: "Invalid grant id" });
        return null;
    }
    const grant = await CoachClassroomGrant.findById(grantId);
    if (!grant) {
        res.status(404).json({ message: "Grant not found" });
        return null;
    }
    const classroom = await Classroom.findById(grant.classroomId)
        .populate("teacher", "name")
        .populate("assistantTeacher", "name");
    if (!classroom) {
        res.status(404).json({ message: "Classroom not found" });
        return null;
    }
    return { grant, classroom };
}

/**
 * Aggregate-tier decisions (approve/deny) are for the classroom's LEAD
 * teacher or an admin. Assistants can manage the classroom but do not
 * decide coach access; admins pass canManageClassroom anyway.
 */
function mayDecideAggregate(user, classroom) {
    if (user.role === "admin") return true;
    return user.role === "teacher" && String(classroom.teacher?._id ?? classroom.teacher) === String(user.id);
}

/** PATCH /api/coaches/grants/:grantId/approve — lead teacher or admin. */
export const approveGrant = async (req, res) => {
    try {
        const loaded = await loadGrantWithClassroom(req.params.grantId, res);
        if (!loaded) return;
        const { grant, classroom } = loaded;
        if (!mayDecideAggregate(req.user, classroom)) {
            return res.status(403).json({ message: "Only the lead teacher or an admin can approve coach access" });
        }
        if (grant.status !== "pending") {
            return res.status(400).json({ message: `Grant is ${grant.status}, not pending` });
        }

        grant.status = "active";
        grant.decidedBy = req.user.id;
        grant.decidedByRole = req.user.role;
        await grant.save();

        await createCoachGrantNotification({
            recipientId: grant.coachId,
            recipientRole: "coach",
            type: "coach-access-approved",
            classroom,
            message: `Your access request for classroom "${classroom.name}" was approved`,
        });

        res.status(200).json({ message: "Access approved", grant });
    } catch (error) {
        console.error("Error approving coach grant:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/** PATCH /api/coaches/grants/:grantId/deny — lead teacher or admin. */
export const denyGrant = async (req, res) => {
    try {
        const loaded = await loadGrantWithClassroom(req.params.grantId, res);
        if (!loaded) return;
        const { grant, classroom } = loaded;
        if (!mayDecideAggregate(req.user, classroom)) {
            return res.status(403).json({ message: "Only the lead teacher or an admin can deny coach access" });
        }
        if (grant.status !== "pending") {
            return res.status(400).json({ message: `Grant is ${grant.status}, not pending` });
        }

        grant.status = "revoked";
        grant.transcriptAccess = false;
        grant.decidedBy = req.user.id;
        grant.decidedByRole = req.user.role;
        await grant.save();

        await createCoachGrantNotification({
            recipientId: grant.coachId,
            recipientRole: "coach",
            type: "coach-access-denied",
            classroom,
            message: `Your access request for classroom "${classroom.name}" was denied`,
        });

        res.status(200).json({ message: "Access denied", grant });
    } catch (error) {
        console.error("Error denying coach grant:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/** PATCH /api/coaches/grants/:grantId/revoke — admin or classroom lead teacher. */
export const revokeGrant = async (req, res) => {
    try {
        const loaded = await loadGrantWithClassroom(req.params.grantId, res);
        if (!loaded) return;
        const { grant, classroom } = loaded;
        if (!mayDecideAggregate(req.user, classroom)) {
            return res.status(403).json({ message: "Only the lead teacher or an admin can revoke coach access" });
        }
        if (grant.status === "revoked") {
            return res.status(200).json({ message: "Grant already revoked", grant });
        }

        grant.status = "revoked";
        grant.transcriptAccess = false;
        grant.decidedBy = req.user.id;
        grant.decidedByRole = req.user.role;
        await grant.save();

        await createCoachGrantNotification({
            recipientId: grant.coachId,
            recipientRole: "coach",
            type: "coach-access-revoked",
            classroom,
            message: `Your access to classroom "${classroom.name}" was revoked`,
        });

        res.status(200).json({ message: "Access revoked", grant });
    } catch (error) {
        console.error("Error revoking coach grant:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/**
 * PATCH /api/coaches/grants/:grantId/transcript-access — ADMIN ONLY
 * (enforced by requireCapability at the route). Body: { enabled: boolean }.
 */
export const setTranscriptAccess = async (req, res) => {
    try {
        const loaded = await loadGrantWithClassroom(req.params.grantId, res);
        if (!loaded) return;
        const { grant, classroom } = loaded;
        const enabled = req.body?.enabled === true;

        if (grant.status !== "active") {
            return res.status(400).json({ message: "Transcript access requires an active grant" });
        }
        if (grant.transcriptAccess === enabled) {
            return res.status(200).json({ message: "No change", grant });
        }

        grant.transcriptAccess = enabled;
        grant.transcriptDecidedBy = req.user.id;
        await grant.save();

        const verb = enabled ? "granted" : "revoked";
        await createCoachGrantNotification({
            recipientId: grant.coachId,
            recipientRole: "coach",
            type: "coach-transcript-access-changed",
            classroom,
            message: `Transcript access for classroom "${classroom.name}" was ${verb}`,
        });
        if (classroom.teacher?._id) {
            await createCoachGrantNotification({
                recipientId: classroom.teacher._id,
                recipientRole: "teacher",
                type: "coach-transcript-access-changed",
                classroom,
                message: `A coach's transcript access for classroom "${classroom.name}" was ${verb}`,
            });
        }

        res.status(200).json({ message: `Transcript access ${verb}`, grant });
    } catch (error) {
        console.error("Error setting transcript access:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};

/** GET /api/coaches/grants/pending-for-teacher — lead teacher's pending queue. */
export const pendingGrantsForTeacher = async (req, res) => {
    try {
        const classrooms = await Classroom.find({ teacher: req.user.id }).select("_id name");
        const ids = classrooms.map((c) => c._id);
        const grants = await CoachClassroomGrant.find({
            classroomId: { $in: ids },
            status: "pending",
        }).populate("coachId", "name email");
        res.status(200).json({
            grants: grants.map((g) => ({
                id: g._id,
                coach: g.coachId ? { id: g.coachId._id, name: g.coachId.name, email: g.coachId.email } : null,
                classroomId: g.classroomId,
                classroomName: classrooms.find((c) => String(c._id) === String(g.classroomId))?.name ?? "",
                requestedAt: g.requestedAt,
            })),
        });
    } catch (error) {
        console.error("Error listing pending coach grants:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};
