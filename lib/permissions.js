import { canManageClassroom } from "./classroomHelpers.js";

/**
 * Central authorization policy for the four login roles.
 *
 * Two layers:
 *  1. CAPABILITIES — a static role→capability matrix for actions that are
 *     purely role-gated ("can this kind of user ever do this?").
 *  2. Relationship policy functions — resource-scoped decisions that also
 *     depend on standing relationships (classroom lead/assistant, enrolled
 *     parent, coach grant).
 *
 * Unknown capabilities and unknown roles fail closed.
 */

export const ROLES = ["admin", "teacher", "parent", "coach"];

export const CAPABILITIES = Object.freeze({
    manageSchools: ["admin"],
    manageTeachers: ["admin"],
    manageChildren: ["admin", "teacher"],
    manageCoaches: ["admin"],
    inviteParents: ["admin", "teacher"],
    inviteTeachers: ["admin"],
    inviteCoaches: ["admin"],
    /** Classroom recording flow: teachers only (admins removed, coaches never). */
    uploadClassroomRecording: ["teacher"],
    /** Home recording flow: parents only. */
    uploadHomeRecording: ["parent"],
    /** Approve/deny a coach's aggregate-tier classroom request. */
    approveCoachAggregateAccess: ["admin", "teacher"],
    /** Grant/revoke the transcript tier on a coach grant: admins only. */
    grantCoachTranscriptAccess: ["admin"],
    requestCoachClassroomAccess: ["coach"],
});

export function roleHasCapability(role, capability) {
    const allowed = CAPABILITIES[capability];
    if (!Array.isArray(allowed)) return false;
    return allowed.includes(role);
}

function forbid(res, message = "You do not have permission to perform this action") {
    return res.status(403).json({ message });
}

/** Express middleware: allow only the listed roles. */
export function requireRole(...roles) {
    return (req, res, next) => {
        const role = req.user?.role;
        if (!role || !roles.includes(role)) return forbid(res);
        next();
    };
}

/** Express middleware: allow only roles granted the named capability. */
export function requireCapability(capability) {
    return (req, res, next) => {
        if (!roleHasCapability(req.user?.role, capability)) return forbid(res);
        next();
    };
}

function idOf(value) {
    if (value == null) return "";
    return String(value._id ?? value.id ?? value);
}

/** True when the user is a parent enrolled in the classroom's parent roster. */
export function isEnrolledParent(user, classroom) {
    if (!user || user.role !== "parent" || !classroom) return false;
    const uid = idOf(user);
    if (!uid) return false;
    return (classroom.parents || []).some((p) => idOf(p) === uid);
}

/**
 * Lazy import to avoid a circular dependency: CoachClassroomGrant is only
 * needed for coach callers, and this module is imported broadly.
 */
async function findActiveCoachGrant(coachId, classroomId) {
    const { default: CoachClassroomGrant } = await import("../models/CoachClassroomGrant.js");
    return CoachClassroomGrant.findOne({
        coachId,
        classroomId,
        status: "active",
    }).lean();
}

/**
 * Aggregate-tier classroom read access: classroom managers (admin,
 * lead/assistant teacher), enrolled parents, and coaches holding an ACTIVE
 * grant. Aggregate tier covers talk counts, WPM, and visualizations — not
 * transcript text.
 */
export async function canViewClassroomAggregates(user, classroom) {
    if (!user || !classroom) return false;
    if (canManageClassroom(user, classroom)) return true;
    if (isEnrolledParent(user, classroom)) return true;
    if (user.role === "coach") {
        const grant = await findActiveCoachGrant(idOf(user), idOf(classroom));
        return !!grant;
    }
    return false;
}

/**
 * Transcript-tier classroom read access: managers and enrolled parents as
 * before; coaches additionally need the admin-granted `transcriptAccess`
 * flag on their active grant.
 */
export async function canViewClassroomTranscripts(user, classroom) {
    if (!user || !classroom) return false;
    if (canManageClassroom(user, classroom)) return true;
    if (isEnrolledParent(user, classroom)) return true;
    if (user.role === "coach") {
        const grant = await findActiveCoachGrant(idOf(user), idOf(classroom));
        return !!grant?.transcriptAccess;
    }
    return false;
}

/**
 * The access tier a coach holds on a classroom:
 * "none" | "requested" | "aggregate" | "transcripts".
 */
export async function coachClassroomTier(coachId, classroomId) {
    const { default: CoachClassroomGrant } = await import("../models/CoachClassroomGrant.js");
    const grant = await CoachClassroomGrant.findOne({ coachId, classroomId }).lean();
    if (!grant || grant.status === "revoked") return "none";
    if (grant.status === "pending") return "requested";
    return grant.transcriptAccess ? "transcripts" : "aggregate";
}

export { canManageClassroom };
