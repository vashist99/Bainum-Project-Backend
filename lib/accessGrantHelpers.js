import mongoose from "mongoose";
import AccessGrant from "../models/AccessGrant.js";

/**
 * @param {string|mongoose.Types.ObjectId} teacherId
 * @param {string|mongoose.Types.ObjectId} childId
 * @returns {Promise<boolean>}
 */
export async function hasActiveTeacherChildGrant(teacherId, childId) {
    const g = await AccessGrant.findOne({
        teacherId,
        childId,
        status: "active",
    }).lean();
    return !!g;
}

/**
 * Parent can view teacher's classroom data if there is an active grant for (parent, teacher, child).
 * @param {string|mongoose.Types.ObjectId} parentId
 * @param {string|mongoose.Types.ObjectId} teacherId
 * @param {string|mongoose.Types.ObjectId} childId
 */
export async function hasActiveParentTeacherGrant(parentId, teacherId, childId) {
    const g = await AccessGrant.findOne({
        parentId,
        teacherId,
        childId,
        status: "active",
    }).lean();
    return !!g;
}

/**
 * Parent has an active grant with this teacher for any of the given children.
 * @param {string|mongoose.Types.ObjectId} parentId
 * @param {string|mongoose.Types.ObjectId} teacherId
 * @param {string[]} childIdStrs
 */
export async function hasActiveParentTeacherGrantForAnyChild(parentId, teacherId, childIdStrs) {
    if (!childIdStrs?.length) return false;
    const g = await AccessGrant.findOne({
        parentId,
        teacherId,
        childId: { $in: childIdStrs },
        status: "active",
    }).lean();
    return !!g;
}
