import dotenv from "dotenv";
import fs from "fs";
import mongoose from "mongoose";
import revai from "../lib/revai.js";
import ragClassifier from "../lib/ragClassifier.js";
import hybridScorer from "../lib/hybridScorer.js";
import { analyzeTranscript, calculateScores, extractKeywordSegments } from "../lib/transcriptProcessor.js";
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

        const transcriptionResult = await revai.transcribeFromFile(filePath, {
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            skipDiarization: true,
            language: 'en'
        });

        const transcript = revai.getTranscript(transcriptionResult);

        const keywordCounts = analyzeTranscript(transcript || "");
        const keywordScores = calculateScores(keywordCounts);

        let ragScores = null;
        let ragSegments = null;
        let finalScores = keywordScores;
        const ragEnabled = process.env.RAG_ENABLED?.toString().toLowerCase().trim() === 'true';

        if (ragEnabled && transcript && transcript.trim().length > 0) {
            try {
                const ragResult = await ragClassifier.classifyWithSegments(transcript);
                ragScores = ragResult.scores;
                ragSegments = ragResult.segments || [];
                finalScores = hybridScorer.combineScores(ragScores, keywordScores);
            } catch (ragError) {
                console.error("RAG classification failed, falling back to keyword-only:", ragError.message);
                ragScores = null;
                ragSegments = null;
            }
        }

        if (!ragSegments || ragSegments.length === 0) {
            ragSegments = extractKeywordSegments(transcript || "");
        }

        let assessmentDate = new Date();
        if (recordingDate) {
            const parsedDate = new Date(recordingDate);
            if (!isNaN(parsedDate.getTime())) {
                assessmentDate = parsedDate;
            }
        }

        const assessmentData = {
            teacherId: mongoose.Types.ObjectId.isValid(teacherId) ? new mongoose.Types.ObjectId(teacherId) : teacherId,
            audioFileName: req.file.filename,
            transcript: transcript || "",
            scienceTalk: finalScores.scienceTalk,
            socialTalk: finalScores.socialTalk,
            literatureTalk: finalScores.literatureTalk,
            languageDevelopment: finalScores.languageDevelopment,
            keywordCounts,
            uploadedBy,
            date: assessmentDate,
            center: center || null
        };

        if (ragScores) {
            assessmentData.ragScores = ragScores;
            assessmentData.ragSegments = ragSegments;
            assessmentData.classificationMethod = 'hybrid';
        } else {
            assessmentData.classificationMethod = 'keyword-only';
        }
        if (ragSegments && ragSegments.length > 0) {
            assessmentData.ragSegments = ragSegments;
        }

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
            scores: finalScores,
            ragScores: ragScores || null,
            ragSegments: ragSegments || null,
            classificationMethod: assessmentData.classificationMethod
        });
    } catch (error) {
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
