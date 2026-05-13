import dotenv from "dotenv";
import fs from "fs";
import mongoose from "mongoose";
import revai from "../lib/revai.js";
import ragClassifier from "../lib/ragClassifier.js";
import {
    analyzeTranscript,
    extractKeywordSegments,
    computeCategoryWordCountFromSegments,
    deriveCategoryWordCountFromKeywordCounts,
} from "../lib/transcriptProcessor.js";
import { Teacher, Parent, Child } from "../models/User.js";
import {
    isPredefinedActivity,
    validateCustomActivity,
} from "../lib/activityValidator.js";
import { getResolvedChildIdStringsForParent } from "../lib/parentChildHelpers.js";

dotenv.config();

/**
 * Resolve the list of child documents that a "Record Activity" upload should be
 * distributed to.
 *  - parent: every child linked to the parent account.
 *  - teacher: every child whose `leadTeacher` matches the teacher's name.
 */
async function resolveTargetChildren(user) {
    if (user.role === "parent") {
        const parent = await Parent.findById(user.id);
        if (!parent) return { error: { status: 404, message: "Parent not found" } };
        const idStrs = await getResolvedChildIdStringsForParent(parent);
        if (idStrs.length === 0) {
            return {
                error: {
                    status: 400,
                    message:
                        "You don't have any children linked to your account yet. Accept an invitation before recording.",
                },
            };
        }
        const oids = idStrs.map((s) => new mongoose.Types.ObjectId(s));
        const children = await Child.find({ _id: { $in: oids } });
        return { children, context: "home" };
    }
    if (user.role === "teacher") {
        const teacher = await Teacher.findById(user.id);
        if (!teacher) return { error: { status: 404, message: "Teacher not found" } };
        const children = await Child.find({ leadTeacher: teacher.name });
        if (children.length === 0) {
            return {
                error: {
                    status: 400,
                    message:
                        "No children are currently assigned to you as lead teacher. Add children before recording.",
                },
            };
        }
        return { children, context: "school" };
    }
    return {
        error: {
            status: 403,
            message: "Only teachers and parents can record activities for their children.",
        },
    };
}

/**
 * POST /api/whisper/activity
 * Transcribes audio and returns assessment data plus the list of target children.
 * Saves nothing — the client must call /api/assessments/activity/accept to commit.
 */
export const activityRecordingController = async (req, res) => {
    let filePath = null;

    try {
        const user = req.user;
        if (!user) return res.status(401).json({ message: "Authentication required" });

        const { activity, recordingDate } = req.body || {};
        const rawActivity = String(activity || "").trim();
        if (!rawActivity) {
            return res.status(400).json({ message: "Please choose or enter an activity before recording." });
        }
        if (rawActivity.length > 120) {
            return res.status(400).json({ message: "Activity must be 120 characters or fewer." });
        }

        if (!req.file) {
            return res.status(400).json({ message: "Audio file is required." });
        }
        filePath = req.file.path;
        if (!fs.existsSync(filePath)) {
            return res.status(500).json({ message: "Uploaded file not found on server" });
        }

        const { children, context, error } = await resolveTargetChildren(user);
        if (error) {
            return res.status(error.status).json({ message: error.message });
        }

        // Validate custom activities — predefined ones for this context are always allowed.
        // (A teacher submitting a parent-only activity like "Bath time" still goes through the LLM.)
        let finalActivity = rawActivity;
        if (!isPredefinedActivity(rawActivity, context)) {
            const decision = await validateCustomActivity(rawActivity, context);
            if (!decision.accepted) {
                return res.status(400).json({
                    message: decision.reason || "Custom activity was not accepted for this context.",
                    activityValidation: decision,
                });
            }
            finalActivity = decision.normalized || rawActivity;
        }

        const abortController = new AbortController();
        req.on("aborted", () => abortController.abort());
        req.on("close", () => {
            if (!res.headersSent) abortController.abort();
        });

        const transcriptionResult = await revai.transcribeFromFile(filePath, {
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            skipDiarization: true,
            language: "en",
            signal: abortController.signal,
        });

        const transcript = revai.getTranscript(transcriptionResult);
        const durationSeconds = transcriptionResult?.durationSeconds ?? null;
        const wordCount = (transcript || "").split(/\s+/).filter((w) => w.length > 0).length;
        const durationMinutes = durationSeconds && durationSeconds > 0 ? durationSeconds / 60 : null;
        const wordsPerMinute = durationMinutes
            ? Math.round((wordCount / durationMinutes) * 10) / 10
            : null;

        const keywordCounts = analyzeTranscript(transcript || "");
        const categoryWordCount = { science: 0, social: 0, literature: 0, language: 0 };
        const categoryWPM = { science: null, social: null, literature: null, language: null };

        let ragSegments = null;
        const ragEnabled = process.env.RAG_ENABLED?.toString().toLowerCase().trim() === "true";
        let classificationMethod = ragEnabled ? "rag" : "keyword-only";

        if (ragEnabled && transcript && transcript.trim().length > 0) {
            try {
                const ragResult = await ragClassifier.classifyWithSegments(transcript);
                ragSegments = ragResult.segments || [];
            } catch (ragError) {
                console.error("[Activity] RAG failed, falling back:", ragError.message);
                ragSegments = null;
            }
        }

        if (!ragSegments || ragSegments.length === 0) {
            ragSegments = extractKeywordSegments(transcript || "");
            if (ragSegments.length === 0 && Object.values(keywordCounts).some((v) => v > 0)) {
                const fallbackCounts = deriveCategoryWordCountFromKeywordCounts(keywordCounts);
                Object.assign(categoryWordCount, fallbackCounts);
                classificationMethod = "keyword-only";
            }
        }

        if (ragSegments && ragSegments.length > 0) {
            const counts = computeCategoryWordCountFromSegments(ragSegments);
            Object.assign(categoryWordCount, counts);
        }
        if (durationMinutes && durationMinutes > 0) {
            Object.keys(categoryWPM).forEach((cat) => {
                categoryWPM[cat] = Math.round(((categoryWordCount[cat] || 0) / durationMinutes) * 10) / 10;
            });
        }

        let assessmentDate = new Date();
        if (recordingDate) {
            const parsed = new Date(recordingDate);
            if (isNaN(parsed.getTime())) {
                return res.status(400).json({ message: "Invalid recording date" });
            }
            const now = new Date();
            if (parsed.getFullYear() !== now.getFullYear()) {
                return res.status(400).json({ message: "Recording date must be in the current year" });
            }
            if (parsed > now) {
                return res.status(400).json({ message: "Recording date cannot be in the future" });
            }
            assessmentDate = parsed;
        }

        const assessmentData = {
            audioFileName: req.file.filename,
            transcript: transcript || "",
            keywordCounts,
            categoryWordCount,
            wordCount,
            durationSeconds,
            wordsPerMinute,
            categoryWPM,
            uploadedBy: user.name || "Unknown",
            date: assessmentDate,
            ragSegments: ragSegments || [],
            classificationMethod,
            activity: finalActivity,
            activityContext: context,
        };

        if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        }

        return res.status(200).json({
            message: "Audio processed — please review before saving.",
            assessment: assessmentData,
            transcript,
            keywordCounts,
            categoryWordCount,
            ragSegments: ragSegments || null,
            classificationMethod,
            activityContext: context,
            targetChildren: children.map((c) => ({ _id: c._id, name: c.name })),
        });
    } catch (error) {
        if (error.message?.includes("cancelled") || error.message?.includes("Processing cancelled by client")) {
            if (filePath && fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch { /* ignore */ }
            }
            if (!res.headersSent) {
                return res.status(499).json({ message: "Processing cancelled" });
            }
            return;
        }

        console.error("[Activity recording] error:", error);
        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        }

        let statusCode = 500;
        let message = error.message || "Failed to process audio";
        if (message.includes("unreachable") || message.includes("ECONNREFUSED")) {
            statusCode = 503;
            message = "RevAI service is not reachable. Please try again later.";
        } else if (message.includes("timeout")) {
            statusCode = 504;
            message = "Audio transcription timed out.";
        }

        return res.status(statusCode).json({ message });
    }
};

/**
 * POST /api/activities/validate
 * Body: { activity, context: "school"|"home" }
 * Used by the UI to give live feedback on a custom activity before recording.
 * Parents can only validate "home"; teachers can only validate "school".
 */
export const validateActivityController = async (req, res) => {
    try {
        const user = req.user;
        if (!user) return res.status(401).json({ message: "Authentication required" });

        const { activity } = req.body || {};
        if (!activity || typeof activity !== "string") {
            return res.status(400).json({ message: "activity is required" });
        }

        let expectedContext;
        if (user.role === "parent") expectedContext = "home";
        else if (user.role === "teacher") expectedContext = "school";
        else {
            return res.status(403).json({ message: "Only parents and teachers can validate activities." });
        }

        if (isPredefinedActivity(activity, expectedContext)) {
            return res.json({
                accepted: true,
                reason: "Predefined activity.",
                normalized: String(activity).trim(),
                context: expectedContext,
                predefined: true,
            });
        }

        const decision = await validateCustomActivity(activity, expectedContext);
        return res.json({ ...decision, context: expectedContext, predefined: false });
    } catch (error) {
        console.error("[validateActivity] error:", error);
        return res.status(500).json({ message: error.message || "Validation failed" });
    }
};
