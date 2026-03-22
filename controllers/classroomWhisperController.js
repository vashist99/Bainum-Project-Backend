import dotenv from "dotenv";
import fs from "fs";
import mongoose from "mongoose";
import revai from "../lib/revai.js";
import ragClassifier from "../lib/ragClassifier.js";
import { analyzeTranscript, extractKeywordSegments, computeCategoryWordCountFromSegments, deriveCategoryWordCountFromKeywordCounts } from "../lib/transcriptProcessor.js";
import { Teacher } from "../models/User.js";

dotenv.config();

const classroomWhisperController = async (req, res) => {
    let filePath = null;

    try {
        const { teacherId: bodyTeacherId, center, recordingDate } = req.body;
        const user = req.user;

        // Determine teacherId based on role
        let teacherId;
        if (user.role === "teacher") {
            teacherId = user.id;
        } else if (user.role === "admin") {
            if (!bodyTeacherId) {
                return res.status(400).json({ message: "Teacher ID is required for admin uploads" });
            }
            teacherId = bodyTeacherId;

            // Validate teacher exists and belongs to selected center (if center provided)
            const teacher = await Teacher.findById(teacherId);
            if (!teacher) {
                return res.status(404).json({ message: "Teacher not found" });
            }
            if (center && teacher.center !== center) {
                return res.status(400).json({ message: "Selected teacher does not belong to the chosen center" });
            }
        } else {
            return res.status(403).json({ message: "Only teachers and admins can upload classroom recordings" });
        }

        if (!req.file) {
            return res.status(400).json({
                message: "Audio file is required. Please select an audio file to upload."
            });
        }

        filePath = req.file.path;
        const uploadedBy = user.name || "Unknown";

        console.log("=== Classroom Audio Processing Request ===");
        console.log("Body:", { teacherId, center, uploadedBy, hasFile: !!req.file });

        if (!fs.existsSync(filePath)) {
            return res.status(500).json({ message: "Uploaded file not found on server" });
        }

        const config = revai.getConfig();
        if (!config.apiKeySet) {
            console.warn("RevAI API key not set - transcription may fail");
        }

        // AbortController: when client cancels, stop polling immediately
        const abortController = new AbortController();
        req.on('aborted', () => abortController.abort());
        req.on('close', () => {
            if (!res.headersSent) abortController.abort();
        });

        const transcriptionResult = await revai.transcribeFromFile(filePath, {
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            skipDiarization: true,
            language: 'en',
            signal: abortController.signal
        });

        const transcript = revai.getTranscript(transcriptionResult);
        const durationSeconds = transcriptionResult?.durationSeconds ?? null;
        const wordCount = (transcript || '').split(/\s+/).filter(w => w.length > 0).length;
        const durationMinutes = durationSeconds && durationSeconds > 0 ? durationSeconds / 60 : null;
        const wordsPerMinute = durationMinutes
            ? Math.round((wordCount / durationMinutes) * 10) / 10
            : null;

        const keywordCounts = analyzeTranscript(transcript || "");
        const categoryWPM = { science: null, social: null, literature: null, language: null };
        const categoryWordCount = { science: 0, social: 0, literature: 0, language: 0 };
        const ragEnabled = process.env.RAG_ENABLED?.toString().toLowerCase().trim() === 'true';

        let ragSegments = null;
        let classificationMethod = ragEnabled ? 'rag' : 'keyword-only';
        if (ragEnabled && transcript && transcript.trim().length > 0) {
            try {
                const ragResult = await ragClassifier.classifyWithSegments(transcript);
                ragSegments = ragResult.segments || [];
            } catch (ragError) {
                console.error("[RAG] Classification failed, falling back to keyword-only:", ragError.message);
            }
        }

        if (!ragSegments || ragSegments.length === 0) {
            ragSegments = extractKeywordSegments(transcript || "");
            if (ragSegments.length > 0) {
                console.log("[RAG] Using keyword-based segments:", ragSegments.length);
            } else if (Object.values(keywordCounts).some((v) => v > 0)) {
                const fallbackCounts = deriveCategoryWordCountFromKeywordCounts(keywordCounts);
                Object.assign(categoryWordCount, fallbackCounts);
                classificationMethod = 'keyword-only';
                console.warn("[RAG] No segments from RAG or keyword extractor, but keywordCounts present; using keywordCounts fallback for WPM");
            }
        }

        if (ragSegments && ragSegments.length > 0) {
            const counts = computeCategoryWordCountFromSegments(ragSegments);
            Object.assign(categoryWordCount, counts);
        }
        if (durationMinutes && durationMinutes > 0) {
            Object.keys(categoryWPM).forEach((cat) => {
                const words = categoryWordCount[cat] || 0;
                categoryWPM[cat] = Math.round((words / durationMinutes) * 10) / 10;
            });
        }

        // Structured logging for debugging sporadic RAG/WPM failures
        const hasSegments = ragSegments && ragSegments.length > 0;
        const hasKeywordFallback = !hasSegments && Object.values(keywordCounts).some((v) => v > 0);
        console.log("[RAG] Classification complete (classroom):", {
            ragEnabled,
            openaiKeySet: !!process.env.OPENAI_API_KEY,
            transcriptLength: transcript?.length || 0,
            segmentCount: ragSegments?.length ?? 0,
            classificationMethod,
            categoryWordCount,
            categoryWPM,
            usedKeywordFallback: hasKeywordFallback
        });

        let assessmentDate = new Date();
        if (recordingDate) {
            const parsedDate = new Date(recordingDate);
            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({ message: "Invalid recording date" });
            }
            const now = new Date();
            const currentYear = now.getFullYear();
            if (parsedDate.getFullYear() !== currentYear) {
                return res.status(400).json({ message: "Recording date must be in the current year" });
            }
            if (parsedDate > now) {
                return res.status(400).json({ message: "Recording date cannot be in the future" });
            }
            assessmentDate = parsedDate;
        }

        const assessmentData = {
            teacherId: mongoose.Types.ObjectId.isValid(teacherId) ? new mongoose.Types.ObjectId(teacherId) : teacherId,
            audioFileName: req.file.filename,
            transcript: transcript || "",
            scienceTalk: 0,
            socialTalk: 0,
            literatureTalk: 0,
            languageDevelopment: 0,
            keywordCounts,
            categoryWordCount,
            wordCount,
            durationSeconds,
            wordsPerMinute,
            categoryWPM,
            uploadedBy,
            date: assessmentDate,
            center: center || null,
            ragSegments: ragSegments || [],
            classificationMethod
        };

        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (cleanupError) {
                console.warn("Could not delete uploaded file:", cleanupError.message);
            }
        }

        res.status(200).json({
            message: "Audio processed successfully - please review transcript",
            assessment: assessmentData,
            transcript,
            keywordCounts,
            categoryWordCount,
            ragSegments: ragSegments || null,
            classificationMethod: assessmentData.classificationMethod
        });
    } catch (error) {
        if (error.message?.includes('cancelled') || error.message?.includes('Processing cancelled by client')) {
            console.log("Classroom audio processing cancelled by client");
            if (filePath && fs.existsSync(filePath)) {
                try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
            }
            if (!res.headersSent) {
                return res.status(499).json({ message: "Processing cancelled" });
            }
            return;
        }

        console.error("Classroom audio processing error:", error);

        if (filePath && fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (cleanupError) {
                console.warn("Could not delete uploaded file after error:", cleanupError.message);
            }
        }

        let errorMessage = "Failed to process audio";
        let statusCode = 500;

        if (error.message.includes("unreachable") || error.message.includes("ECONNREFUSED")) {
            errorMessage = "RevAI service is not reachable. Please check your internet connection and API key.";
            statusCode = 503;
        } else if (error.message.includes("timeout")) {
            errorMessage = "Audio transcription timed out.";
            statusCode = 504;
        } else {
            errorMessage = error.message || errorMessage;
        }

        res.status(statusCode).json({
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
};

export default classroomWhisperController;
