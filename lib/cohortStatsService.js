import Assessment from "../models/Assessment.js";
import TeacherAssessment from "../models/TeacherAssessment.js";
import CohortStats from "../models/CohortStats.js";

const CATEGORIES = ["science", "social", "literature", "language"];

/**
 * Compute cohort stats from assessments (mins/maxs per entity, then avg of those)
 * @param {Array} assessments - Array of assessment docs with entityId and categoryWPM
 * @param {string} idField - Field name for entity ID (teacherId or childId)
 * @returns {Object} { category: { avgMin, avgMax } }
 */
function computeCohortStatsFromAssessments(assessments, idField) {
    const minsByEntity = {};
    const maxsByEntity = {};
    assessments.forEach((a) => {
        const eid = a[idField]?.toString();
        if (!eid) return;
        if (!minsByEntity[eid]) minsByEntity[eid] = {};
        if (!maxsByEntity[eid]) maxsByEntity[eid] = {};
        CATEGORIES.forEach((cat) => {
            const v = a.categoryWPM?.[cat];
            if (v != null && !isNaN(v)) {
                if (minsByEntity[eid][cat] == null || v < minsByEntity[eid][cat]) minsByEntity[eid][cat] = v;
                if (maxsByEntity[eid][cat] == null || v > maxsByEntity[eid][cat]) maxsByEntity[eid][cat] = v;
            }
        });
    });
    const result = {};
    CATEGORIES.forEach((cat) => {
        const mins = Object.values(minsByEntity).map((o) => o[cat]).filter((v) => v != null && !isNaN(v));
        const maxs = Object.values(maxsByEntity).map((o) => o[cat]).filter((v) => v != null && !isNaN(v));
        result[cat] = {
            avgMin: mins.length > 0 ? mins.reduce((s, v) => s + v, 0) / mins.length : null,
            avgMax: maxs.length > 0 ? maxs.reduce((s, v) => s + v, 0) / maxs.length : null
        };
    });
    return result;
}

/**
 * Recalculate and persist children cohort stats. Call after a child assessment is accepted.
 */
export async function recomputeAndSaveChildrenCohortStats() {
    const assessments = await Assessment.find({}).select("childId categoryWPM");
    const stats = computeCohortStatsFromAssessments(assessments, "childId");
    await CohortStats.findOneAndUpdate(
        { type: "children" },
        { stats, updatedAt: new Date() },
        { upsert: true, new: true }
    );
    console.log("✓ Children cohort stats recalculated and saved");
    return stats;
}

/**
 * Recalculate and persist teachers cohort stats. Call after a teacher assessment is accepted.
 */
export async function recomputeAndSaveTeachersCohortStats() {
    const assessments = await TeacherAssessment.find({}).select("teacherId categoryWPM");
    const stats = computeCohortStatsFromAssessments(assessments, "teacherId");
    await CohortStats.findOneAndUpdate(
        { type: "teachers" },
        { stats, updatedAt: new Date() },
        { upsert: true, new: true }
    );
    console.log("✓ Teachers cohort stats recalculated and saved");
    return stats;
}

/**
 * Get stored cohort stats, or compute and save if not yet stored (bootstrap).
 * @param {"teachers"|"children"} type
 * @returns {Promise<Object|null>} cohortStats by category
 */
export async function getCohortStats(type) {
    const doc = await CohortStats.findOne({ type });
    if (doc && doc.stats) {
        return doc.stats;
    }
    if (type === "teachers") {
        const stats = await recomputeAndSaveTeachersCohortStats();
        return stats;
    }
    if (type === "children") {
        const stats = await recomputeAndSaveChildrenCohortStats();
        return stats;
    }
    return null;
}
