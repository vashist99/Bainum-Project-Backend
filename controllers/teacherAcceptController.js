import mongoose from "mongoose";
import TeacherAssessment from "../models/TeacherAssessment.js";
import Classroom from "../models/Classroom.js";
import { Teacher } from "../models/User.js";
import { isPredefinedActivity, validateCustomActivity } from "../lib/activityValidator.js";
import { resolveValidatedLocation } from "../lib/locationValidator.js";
import {
    roleHasCapability,
    canRecordInClassroom,
    resolveClassroomRecordingTeacherId,
} from "../lib/permissions.js";
import { transcriptExpiryFrom } from "../lib/transcriptRetention.js";
import { fanOutClassroomRecordingAddedNotifications } from "../lib/notificationService.js";
import { redactTranscriptPayload } from "../lib/piiRedaction.js";
import { recomputeAndSaveTeachersCohortStats } from "../lib/cohortStatsService.js";
import { logActivity } from "../lib/activityLogService.js";

/**
 * Persist a reviewed classroom (or legacy teacher) recording.
 * Teachers and coaches with an active grant may accept classroom-scoped rows.
 */
export async function acceptTeacherAssessment(req, res) {
    try {
        const { teacherId, audioFileName, transcript, scienceTalk, socialTalk, literatureTalk, languageDevelopment, keywordCounts, categoryWordCount, ragScores, ragSegments, classificationMethod, uploadedBy, date, center, wordCount, durationSeconds, wordsPerMinute, categoryWPM, classroomId, activity, location } = req.body;

        if (!roleHasCapability(req.user?.role, "uploadClassroomRecording")) {
            return res.status(403).json({ message: "You do not have permission to save classroom recordings" });
        }

        if (req.user?.role === "coach" && !classroomId) {
            return res.status(400).json({ message: "Classroom is required" });
        }

        if (!teacherId && req.user?.role !== "coach") {
            return res.status(400).json({ message: "Teacher ID is required" });
        }

        const finalActivity = String(activity || "").trim() || null;
        if (finalActivity && !isPredefinedActivity(finalActivity, "school")) {
            const decision = await validateCustomActivity(finalActivity, "school");
            if (!decision.accepted) {
                return res.status(400).json({
                    message: decision.reason || "Custom activity was not accepted for this context.",
                });
            }
        }
        const locationResult = await resolveValidatedLocation(location, "school");
        if (!locationResult.ok) {
            return res.status(400).json({ message: locationResult.message });
        }

        let classroomDoc = null;
        if (classroomId) {
            if (!mongoose.Types.ObjectId.isValid(classroomId)) {
                return res.status(400).json({ message: "Invalid classroom id" });
            }
            classroomDoc = await Classroom.findById(classroomId);
            if (!classroomDoc) {
                return res.status(404).json({ message: "Classroom not found" });
            }
            if (!(await canRecordInClassroom(req.user, classroomDoc))) {
                return res.status(403).json({ message: "You do not have access to record in this classroom" });
            }
        }

        let resolvedTeacherId = teacherId;
        if (req.user?.role === "coach") {
            resolvedTeacherId = resolveClassroomRecordingTeacherId(req.user, classroomDoc);
            if (!resolvedTeacherId) {
                return res.status(400).json({
                    message: "This classroom has no lead or assistant teacher to attribute the recording to",
                });
            }
        }

        const teacherIdObject = mongoose.Types.ObjectId.isValid(resolvedTeacherId)
            ? new mongoose.Types.ObjectId(resolvedTeacherId)
            : resolvedTeacherId;

        const teacherDoc = await Teacher.findById(teacherIdObject);
        if (!teacherDoc) {
            return res.status(404).json({ message: "Teacher not found" });
        }

        const assessmentDate = date ? new Date(date) : new Date();
        const transcriptExpiresAt = transcriptExpiryFrom(assessmentDate);
        const safeKeywordCounts = keywordCounts || { science: 0, social: 0, literature: 0, language: 0 };
        const safeCategoryWordCount = categoryWordCount || { science: 0, social: 0, literature: 0, language: 0 };
        const safeCategoryWPM = categoryWPM ?? { science: null, social: null, literature: null, language: null };
        const safeUploadedBy = req.user?.role === "coach"
            ? (req.user.name || "Unknown")
            : (uploadedBy || "Unknown");
        const safeCenter = center || teacherDoc.center || null;

        const redacted = await redactTranscriptPayload({ transcript, ragSegments });

        const assessment = new TeacherAssessment({
            teacherId: teacherIdObject,
            classroomId: classroomDoc ? classroomDoc._id : undefined,
            audioFileName: audioFileName || "",
            transcript: redacted.transcript,
            scienceTalk: scienceTalk || 0,
            socialTalk: socialTalk || 0,
            literatureTalk: literatureTalk || 0,
            languageDevelopment: languageDevelopment || 0,
            keywordCounts: safeKeywordCounts,
            categoryWordCount: safeCategoryWordCount,
            ragScores: ragScores || null,
            ragSegments: redacted.ragSegments || null,
            classificationMethod: classificationMethod || "keyword-only",
            uploadedBy: safeUploadedBy,
            date: assessmentDate,
            transcriptExpiresAt,
            center: safeCenter,
            activity: finalActivity || undefined,
            activityContext: "school",
            location: locationResult.location || undefined,
            wordCount: wordCount ?? null,
            durationSeconds: durationSeconds ?? null,
            wordsPerMinute: wordsPerMinute ?? null,
            categoryWPM: safeCategoryWPM,
        });

        await assessment.save();

        await recomputeAndSaveTeachersCohortStats().catch((err) => console.error("Failed to update teachers cohort stats:", err));

        if (
            classroomDoc &&
            (req.user?.role === "admin" || req.user?.role === "teacher" || req.user?.role === "coach")
        ) {
            try {
                const parentIds = (classroomDoc.parents || []).map(
                    (p) => p._id ?? p
                );
                await fanOutClassroomRecordingAddedNotifications({
                    classroom: classroomDoc,
                    parentIds,
                });
            } catch (notifyErr) {
                console.error(
                    "[teacherAccept] classroom recording notification failed:",
                    notifyErr.message
                );
            }
        }

        void logActivity({
            actor: req.user,
            action: "transcript-accepted",
            targetType: classroomDoc ? "classroom" : "assessment",
            targetId: classroomDoc ? classroomDoc._id : assessment._id,
            targetLabel: classroomDoc?.name || finalActivity || "",
            detail: classroomDoc
                ? "Accepted a classroom recording transcript"
                : "Accepted a recording transcript",
        });

        res.status(201).json({
            message: classroomDoc
                ? "Classroom recording saved."
                : "Teacher assessment saved successfully",
            assessment,
        });
    } catch (error) {
        console.error("Error saving teacher assessment:", error);
        res.status(500).json({ message: error.message });
    }
}
