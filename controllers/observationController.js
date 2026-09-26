import mongoose from "mongoose";
import TeacherAssessment from "../models/TeacherAssessment.js";
import Assessment from "../models/Assessment.js";
import Classroom from "../models/Classroom.js";
import { Parent } from "../models/User.js";
import {
    observationVisibleTo,
    canHideObservation,
    serializeObservationMeta,
    appendObservationComment,
} from "../lib/observationVisibility.js";
import { canViewClassroomTranscripts } from "../lib/permissions.js";
import { parentMayAccessChild, getResolvedChildIdStringsForParent } from "../lib/parentChildHelpers.js";
import { teacherMayAccessChild } from "../lib/noteAccessHelpers.js";
import {
    homeTalkFilterForRequest,
    isStaffRole,
    staffHasHomeTranscriptAccess,
} from "../lib/talkDataAccess.js";
import { hasActiveParentTeacherGrantForAnyChild } from "../lib/accessGrantHelpers.js";
import {
    recomputeAndSaveTeachersCohortStats,
    recomputeAndSaveChildrenCohortStats,
} from "../lib/cohortStatsService.js";
import { logActivity } from "../lib/activityLogService.js";

function userId(user) {
    return user?.id ?? user?._id;
}

function invalidId(id) {
    return !mongoose.Types.ObjectId.isValid(id);
}

function forbidden(res, message = "You do not have access to this observation") {
    return res.status(403).json({ message });
}

async function canAccessTeacherPlace(user, doc) {
    if (doc.classroomId) {
        const classroom = await Classroom.findById(doc.classroomId);
        if (!classroom) return false;
        return canViewClassroomTranscripts(user, classroom);
    }
    if (user?.role === "admin") return true;
    if (user?.role === "teacher" && String(userId(user)) === String(doc.teacherId)) {
        return true;
    }
    if (user?.role === "parent") {
        const parent = await Parent.findById(userId(user));
        if (!parent) return false;
        const childIdStrs = await getResolvedChildIdStringsForParent(parent);
        return hasActiveParentTeacherGrantForAnyChild(parent._id, doc.teacherId, childIdStrs);
    }
    return false;
}

async function canAccessChildPlace(user, doc) {
    const childId = doc.childId;
    if (user?.role === "parent") {
        const parent = await Parent.findById(userId(user));
        return Boolean(parent && (await parentMayAccessChild(parent, childId)));
    }
    if (user?.role === "teacher") {
        return teacherMayAccessChild(userId(user), childId);
    }
    if (user?.role === "admin") return true;
    return false;
}

async function loadTeacherAssessment(req, res) {
    const { assessmentId } = req.params;
    if (invalidId(assessmentId)) {
        res.status(400).json({ message: "Invalid assessment ID" });
        return null;
    }
    const doc = await TeacherAssessment.findById(assessmentId);
    if (!doc) {
        res.status(404).json({ message: "Assessment not found" });
        return null;
    }
    return doc;
}

async function loadChildAssessment(req, res) {
    const { assessmentId } = req.params;
    if (invalidId(assessmentId)) {
        res.status(400).json({ message: "Invalid assessment ID" });
        return null;
    }
    const doc = await Assessment.findById(assessmentId);
    if (!doc) {
        res.status(404).json({ message: "Assessment not found" });
        return null;
    }
    return doc;
}

function observationPayload(user, doc) {
    return {
        assessmentId: doc._id,
        ...serializeObservationMeta(user, doc),
    };
}

export async function patchTeacherObservationNote(req, res) {
    try {
        const doc = await loadTeacherAssessment(req, res);
        if (!doc) return;
        if (!(await canAccessTeacherPlace(req.user, doc))) {
            return forbidden(res);
        }
        if (!observationVisibleTo(req.user, doc)) {
            return forbidden(res);
        }
        const result = await appendObservationComment(
            TeacherAssessment,
            doc,
            req.user,
            req.body?.text
        );
        if (result.error) {
            return res.status(result.status || 400).json({ message: result.error });
        }
        return res.status(200).json(observationPayload(req.user, result.doc));
    } catch (error) {
        console.error("Error saving observation comment:", error);
        return res.status(500).json({ message: error.message });
    }
}

export async function patchTeacherObservationHidden(req, res) {
    try {
        const doc = await loadTeacherAssessment(req, res);
        if (!doc) return;
        if (!(await canAccessTeacherPlace(req.user, doc))) {
            return forbidden(res);
        }
        if (!canHideObservation(req.user, doc)) {
            return forbidden(res, "Only the recorder can hide this observation");
        }
        doc.hidden = Boolean(req.body?.hidden);
        await doc.save();
        await recomputeAndSaveTeachersCohortStats().catch((err) =>
            console.error("Failed to update teachers cohort stats:", err)
        );
        void logActivity({
            actor: req.user,
            action: doc.hidden ? "observation-hidden" : "observation-unhidden",
            targetType: doc.classroomId ? "classroom" : "assessment",
            targetId: doc.classroomId || doc._id,
            targetLabel: "",
            detail: doc.hidden ? "Hid an observation" : "Unhid an observation",
        });
        return res.status(200).json(observationPayload(req.user, doc));
    } catch (error) {
        console.error("Error updating observation visibility:", error);
        return res.status(500).json({ message: error.message });
    }
}

export async function patchChildObservationNote(req, res) {
    try {
        const doc = await loadChildAssessment(req, res);
        if (!doc) return;
        if (!(await canAccessChildPlace(req.user, doc))) {
            return forbidden(res);
        }
        const homeFilter = await homeTalkFilterForRequest(req.user, doc.childId);
        if (!homeFilter) {
            return forbidden(res);
        }
        if (
            isStaffRole(req.user?.role) &&
            !(await staffHasHomeTranscriptAccess(req.user, doc.childId))
        ) {
            return forbidden(res);
        }
        if (!observationVisibleTo(req.user, doc)) {
            return forbidden(res);
        }
        const result = await appendObservationComment(
            Assessment,
            doc,
            req.user,
            req.body?.text
        );
        if (result.error) {
            return res.status(result.status || 400).json({ message: result.error });
        }
        return res.status(200).json(observationPayload(req.user, result.doc));
    } catch (error) {
        console.error("Error saving child observation comment:", error);
        return res.status(500).json({ message: error.message });
    }
}

export async function patchChildObservationHidden(req, res) {
    try {
        const doc = await loadChildAssessment(req, res);
        if (!doc) return;
        if (!(await canAccessChildPlace(req.user, doc))) {
            return forbidden(res);
        }
        const homeFilter = await homeTalkFilterForRequest(req.user, doc.childId);
        if (!homeFilter) {
            return forbidden(res);
        }
        if (!canHideObservation(req.user, doc)) {
            return forbidden(res, "Only the recorder can hide this observation");
        }
        doc.hidden = Boolean(req.body?.hidden);
        await doc.save();
        await recomputeAndSaveChildrenCohortStats().catch((err) =>
            console.error("Failed to update children cohort stats:", err)
        );
        void logActivity({
            actor: req.user,
            action: doc.hidden ? "observation-hidden" : "observation-unhidden",
            targetType: "child",
            targetId: doc.childId,
            targetLabel: "",
            detail: doc.hidden ? "Hid an observation" : "Unhid an observation",
        });
        return res.status(200).json(observationPayload(req.user, doc));
    } catch (error) {
        console.error("Error updating child observation visibility:", error);
        return res.status(500).json({ message: error.message });
    }
}
