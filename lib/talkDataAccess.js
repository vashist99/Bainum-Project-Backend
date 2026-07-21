import HomeViewGrant from "../models/HomeViewGrant.js";

/**
 * Home talk data privacy: parent home recordings (activityContext 'home')
 * belong to the family. Teachers and admins may only see classroom data
 * unless the child's parent granted home view access (HomeViewGrant).
 * Legacy assessments without activityContext predate home recording and
 * count as classroom data.
 */

export function isStaffRole(role) {
    return role === "teacher" || role === "admin";
}

/**
 * True when the staff user may view the child's home talk data: an
 * ACTIVE HomeViewGrant with scope 'all-staff', or scope 'user' naming
 * the caller. Never true for non-staff roles (parents don't need it).
 * No caching — revocation takes effect on the next request.
 */
export async function staffHasHomeViewAccess(user, childId) {
    if (!user?.id || !childId || !isStaffRole(user.role)) return false;
    const grant = await HomeViewGrant.exists({
        childId,
        status: "active",
        $or: [{ scope: "all-staff" }, { scope: "user", granteeId: user.id }],
    });
    return !!grant;
}

/**
 * True when the staff user may read home TRANSCRIPT text for the child:
 * an ACTIVE covering grant (all-staff or naming the caller) whose
 * admin-controlled `transcriptAccess` flag is set. The parent's grant
 * alone (transcriptAccess false) covers visualizations only.
 */
export async function staffHasHomeTranscriptAccess(user, childId) {
    if (!user?.id || !childId || !isStaffRole(user.role)) return false;
    const grant = await HomeViewGrant.exists({
        childId,
        status: "active",
        transcriptAccess: true,
        $or: [{ scope: "all-staff" }, { scope: "user", granteeId: user.id }],
    });
    return !!grant;
}

/** Fields that belong to the transcript tier, never the aggregate tier. */
const HOME_TRANSCRIPT_FIELDS = ["transcript", "ragSegments", "audioFileName"];

/**
 * Aggregate-tier projection of a home assessment: drops transcript text,
 * RAG segments, and the audio reference while keeping every field charts
 * need (keywordCounts, categoryWordCount, categoryWPM, wpm, duration,
 * date, activity). Accepts mongoose docs or plain objects; returns a
 * plain object.
 */
export function stripHomeTranscriptFields(assessment) {
    if (!assessment) return assessment;
    const plain =
        typeof assessment.toObject === "function"
            ? assessment.toObject()
            : { ...assessment };
    for (const field of HOME_TRANSCRIPT_FIELDS) {
        delete plain[field];
    }
    return plain;
}

/**
 * Mongo filter fragment selecting home talk rows only. The child data
 * page (and its APIs) serve home talk exclusively — classroom talk lives
 * on the classroom homepage, sourced from TeacherAssessment.
 */
export function homeOnlyContextFilter() {
    return { activityContext: "home" };
}

/**
 * Home-talk filter for a child assessment read: parents always read
 * their child's home rows; staff read them only under an active
 * HomeViewGrant. Returns null when the caller may not see any home talk
 * data (the endpoint should respond with an empty result).
 */
export async function homeTalkFilterForRequest(user, childId) {
    if (!isStaffRole(user?.role)) return homeOnlyContextFilter();
    if (await staffHasHomeViewAccess(user, childId)) return homeOnlyContextFilter();
    return null;
}

export function isHomeAssessment(assessment) {
    return assessment?.activityContext === "home";
}
