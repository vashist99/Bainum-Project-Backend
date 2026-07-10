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

/** Mongo filter fragment that excludes parent home recordings. */
export function staffHomeContextFilter() {
    return { activityContext: { $ne: "home" } };
}

/**
 * Home-context filter for a child assessment read: parents get no
 * filter, staff get the exclusion filter UNLESS they hold home view
 * access for this child. Used by the child assessment endpoints only —
 * classroom endpoints and cohort stats always exclude home rows.
 */
export async function homeContextFilterForRequest(user, childId) {
    if (!isStaffRole(user?.role)) return {};
    if (await staffHasHomeViewAccess(user, childId)) return {};
    return staffHomeContextFilter();
}

export function isHomeAssessment(assessment) {
    return assessment?.activityContext === "home";
}
