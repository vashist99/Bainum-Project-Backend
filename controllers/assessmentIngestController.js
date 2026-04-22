import mongoose from "mongoose";
import { Parent } from "../models/User.js";
import Assessment from "../models/Assessment.js";
import { recomputeAndSaveChildrenCohortStats } from "../lib/cohortStatsService.js";
import { getResolvedChildIdStringsForParent } from "../lib/parentChildHelpers.js";

function addOneMonth(dateLike) {
    const d = new Date(dateLike);
    d.setMonth(d.getMonth() + 1);
    return d;
}

/**
 * Case-insensitive parent email lookup.
 * @param {string} email
 */
async function findParentByEmail(email) {
    const trimmed = email.trim();
    if (!trimmed) return null;
    return Parent.findOne({
        email: { $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
    });
}

/**
 * POST /api/integrations/assessments/by-parent-email
 * Body: { parentEmail, assessment: { ... same fields as /api/assessments/accept except childId } }
 */
export const ingestAssessmentByParentEmail = async (req, res) => {
    try {
        const { parentEmail, assessment: payload } = req.body || {};

        if (!parentEmail || typeof parentEmail !== "string") {
            return res.status(400).json({ message: "parentEmail is required" });
        }
        if (!payload || typeof payload !== "object") {
            return res.status(400).json({ message: "assessment object is required" });
        }

        const parent = await findParentByEmail(parentEmail);
        if (!parent) {
            return res.status(404).json({ message: "No parent account found for that email" });
        }

        const childIdStrings = await getResolvedChildIdStringsForParent(parent);
        if (childIdStrings.length === 0) {
            return res.status(404).json({ message: "Parent has no linked children" });
        }

        const {
            audioFileName,
            transcript,
            scienceTalk,
            socialTalk,
            literatureTalk,
            languageDevelopment,
            keywordCounts,
            categoryWordCount,
            ragScores,
            ragSegments,
            classificationMethod,
            uploadedBy,
            date,
            wordCount,
            durationSeconds,
            wordsPerMinute,
            categoryWPM,
        } = payload;

        const assessmentDate = date ? new Date(date) : new Date();
        if (Number.isNaN(assessmentDate.getTime())) {
            return res.status(400).json({ message: "Invalid date in assessment" });
        }

        const created = [];

        for (const cidStr of childIdStrings) {
            const childIdObject = mongoose.Types.ObjectId.isValid(cidStr)
                ? new mongoose.Types.ObjectId(cidStr)
                : cidStr;

            const doc = new Assessment({
                childId: childIdObject,
                audioFileName: audioFileName || "",
                transcript: transcript || "",
                scienceTalk: scienceTalk || 0,
                socialTalk: socialTalk || 0,
                literatureTalk: literatureTalk || 0,
                languageDevelopment: languageDevelopment || 0,
                keywordCounts: keywordCounts || {
                    science: 0,
                    social: 0,
                    literature: 0,
                    language: 0,
                },
                categoryWordCount: categoryWordCount || {
                    science: 0,
                    social: 0,
                    literature: 0,
                    language: 0,
                },
                ragScores: ragScores ?? null,
                ragSegments: ragSegments ?? null,
                classificationMethod: classificationMethod || "keyword-only",
                uploadedBy: uploadedBy || "External ingest",
                date: assessmentDate,
                transcriptExpiresAt: addOneMonth(assessmentDate),
                wordCount: wordCount ?? null,
                durationSeconds: durationSeconds ?? null,
                wordsPerMinute: wordsPerMinute ?? null,
                categoryWPM: categoryWPM ?? {
                    science: null,
                    social: null,
                    literature: null,
                    language: null,
                },
            });
            await doc.save();
            created.push({ childId: doc.childId.toString(), assessmentId: doc._id.toString() });
        }

        await recomputeAndSaveChildrenCohortStats().catch((err) =>
            console.error("ingest: cohort stats update failed:", err.message)
        );

        res.status(201).json({
            message: `Created ${created.length} assessment(s) for parent-linked children`,
            parentId: parent._id.toString(),
            parentEmail: parent.email,
            created,
        });
    } catch (error) {
        console.error("ingestAssessmentByParentEmail:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};
