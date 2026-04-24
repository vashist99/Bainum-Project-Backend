import fs from "fs";
import revai from "../lib/revai.js";
import ragClassifier from "../lib/ragClassifier.js";
import {
    analyzeTranscript,
    extractKeywordSegments,
    computeCategoryWordCountFromSegments,
    deriveCategoryWordCountFromKeywordCounts,
} from "../lib/transcriptProcessor.js";
import Assessment from "../models/Assessment.js";
import { Child } from "../models/User.js";
import { recomputeAndSaveChildrenCohortStats } from "../lib/cohortStatsService.js";

/**
 * ENACT integration: receive audio from the ENACT mobile app, transcribe it via RevAI,
 * and auto-save the assessment — no manual review step.
 *
 * The child is looked up by invitedParentEmail, which is set when a parent accepts
 * a Banium invitation. No Banium childId needs to be stored in the ENACT system.
 *
 * Body (multipart/form-data):
 *   audio        - audio file (.m4a)
 *   parentEmail  - email of the parent in the ENACT system
 *   uploadedBy   - display name of the uploader (optional)
 *   recordingDate - ISO date string of when the recording was made (optional)
 */
const enactController = async (req, res) => {
    let filePath = null;

    try {
        console.log("=== ENACT Audio Submission ===");
        const { parentEmail, uploadedBy, recordingDate } = req.body;

        if (!parentEmail) {
            return res.status(400).json({ message: "parentEmail is required" });
        }

        if (!req.file) {
            return res.status(400).json({ message: "Audio file is required" });
        }

        // Look up child by parent email
        const emailNorm = parentEmail.trim().toLowerCase();
        const children = await Child.find({ invitedParentEmail: emailNorm });
        if (!children.length) {
            console.warn(`ENACT: no children found for parentEmail ${emailNorm}`);
            return res.status(404).json({
                message: "No child linked to this parent email in the Banium system. Please ensure the parent has accepted their Banium invitation.",
            });
        }

        console.log(`ENACT: ${children.length} child(ren) found for ${emailNorm}`);
        filePath = req.file.path;

        // Transcribe with RevAI
        const transcriptionResult = await revai.transcribeFromFile(filePath, {
            filename: req.file.filename,
            mimetype: req.file.mimetype,
            skipDiarization: true,
            language: "en",
        });

        const transcript = revai.getTranscript(transcriptionResult);
        const durationSeconds = transcriptionResult?.durationSeconds ?? null;
        const wordCount = (transcript || "").split(/\s+/).filter((w) => w.length > 0).length;
        const durationMinutes = durationSeconds && durationSeconds > 0 ? durationSeconds / 60 : null;
        const wordsPerMinute = durationMinutes
            ? Math.round((wordCount / durationMinutes) * 10) / 10
            : null;

        const categoryWPM = { science: null, social: null, literature: null, language: null };
        const categoryWordCount = { science: 0, social: 0, literature: 0, language: 0 };

        const keywordCounts = analyzeTranscript(transcript || "");

        // RAG classification
        let ragSegments = null;
        const ragEnabled =
            process.env.RAG_ENABLED?.toString().toLowerCase().trim() === "true";

        if (ragEnabled && transcript && transcript.trim().length > 0) {
            try {
                const ragResult = await ragClassifier.classifyWithSegments(transcript);
                ragSegments = ragResult.segments || [];
            } catch (ragError) {
                console.error("ENACT: RAG classification failed, using keyword fallback:", ragError.message);
                ragSegments = null;
            }
        }

        let classificationMethod = ragEnabled ? "rag" : "keyword-only";
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

        // Validate and parse recording date
        let assessmentDate = new Date();
        if (recordingDate) {
            const parsed = new Date(recordingDate);
            if (!isNaN(parsed.getTime())) {
                assessmentDate = parsed;
            }
        }

        // Save one assessment per child linked to this parent
        const assessmentBase = {
            audioFileName: req.file.filename,
            transcript: transcript || "",
            scienceTalk: 0,
            socialTalk: 0,
            literatureTalk: 0,
            languageDevelopment: 0,
            keywordCounts,
            categoryWordCount,
            ragScores: null,
            ragSegments: ragSegments || [],
            classificationMethod,
            uploadedBy: uploadedBy || "Parent",
            date: assessmentDate,
            wordCount,
            durationSeconds,
            wordsPerMinute,
            categoryWPM,
        };

        const savedAssessments = await Promise.all(
            children.map(async (child) => {
                const assessment = new Assessment({ ...assessmentBase, childId: child._id });
                await assessment.save();
                console.log(`ENACT: assessment saved ${assessment._id} for child ${child._id} (${child.name})`);
                return { assessmentId: assessment._id, childId: child._id, childName: child.name };
            })
        );

        await recomputeAndSaveChildrenCohortStats().catch((err) =>
            console.error("ENACT: cohort stats update failed:", err)
        );

        // Clean up uploaded file
        if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        }

        console.log("=== ENACT Submission Complete ===");

        res.status(200).json({
            message: "Recording processed and saved successfully",
            assessments: savedAssessments,
            wordCount,
            durationSeconds,
            wordsPerMinute,
            classificationMethod,
        });
    } catch (error) {
        console.error("ENACT submission error:", error.message);

        if (filePath && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch { /* ignore */ }
        }

        if (!res.headersSent) {
            res.status(500).json({ message: error.message || "Failed to process ENACT recording" });
        }
    }
};

export default enactController;
