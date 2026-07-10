/**
 * Home talk data privacy: parent home recordings (activityContext 'home')
 * belong to the family. Teachers and admins may only see classroom data.
 * Legacy assessments without activityContext predate home recording and
 * count as classroom data.
 */

export function isStaffRole(role) {
    return role === "teacher" || role === "admin";
}

/** Mongo filter fragment that excludes parent home recordings. */
export function staffHomeContextFilter() {
    return { activityContext: { $ne: "home" } };
}

export function isHomeAssessment(assessment) {
    return assessment?.activityContext === "home";
}
