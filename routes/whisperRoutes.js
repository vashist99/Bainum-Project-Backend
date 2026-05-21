import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import mongoose from 'mongoose';
import revaiController from '../controllers/whisperController.js';
import classroomWhisperController from '../controllers/classroomWhisperController.js';
import enactController from '../controllers/enactController.js';
import {
    activityRecordingController,
    validateActivityController,
} from '../controllers/activityRecordingController.js';
import Assessment from '../models/Assessment.js';
import TeacherAssessment from '../models/TeacherAssessment.js';
import authenticateToken from '../middleware/authMiddleware.js';
import { recomputeAndSaveChildrenCohortStats, recomputeAndSaveTeachersCohortStats, getCohortStats } from '../lib/cohortStatsService.js';
import {
    hasActiveTeacherChildGrant,
    hasActiveParentTeacherGrantForAnyChild,
} from '../lib/accessGrantHelpers.js';
import { Parent, Teacher, Child } from '../models/User.js';
import { parentMayAccessChild, getResolvedChildIdStringsForParent } from '../lib/parentChildHelpers.js';
import { isPredefinedActivity, validateCustomActivity } from '../lib/activityValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

function addOneMonth(dateLike) {
    const d = new Date(dateLike);
    d.setMonth(d.getMonth() + 1);
    return d;
}

function toObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
}

/**
 * For parents/teachers: only assessments whose transcript retention is still active.
 * - transcriptExpiresAt in the future, OR
 * - legacy documents with no expiry field but still have transcript text (pre-retention field).
 * Admins do not use this filter.
 */
function transcriptVisibilityFilter() {
    const now = new Date();
    return {
        $or: [
            { transcriptExpiresAt: { $gt: now } },
            {
                $and: [
                    {
                        $or: [
                            { transcriptExpiresAt: { $exists: false } },
                            { transcriptExpiresAt: null },
                        ],
                    },
                    { transcript: { $exists: true, $nin: [null, ''] } },
                ],
            },
        ],
    };
}

async function purgeExpiredTranscripts() {
    const now = new Date();
    await Promise.all([
        Assessment.updateMany(
            {
                transcriptExpiresAt: { $lte: now },
                transcript: { $exists: true, $ne: '' },
            },
            {
                $set: { transcript: '' },
                $unset: { ragSegments: 1 },
            }
        ),
        TeacherAssessment.updateMany(
            {
                transcriptExpiresAt: { $lte: now },
                transcript: { $exists: true, $ne: '' },
            },
            {
                $set: { transcript: '' },
                $unset: { ragSegments: 1 },
            }
        ),
    ]);
}

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for audio file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'audio-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 25 * 1024 * 1024 // 25MB limit for audio files
    },
    fileFilter: (req, file, cb) => {
        // Accept common audio formats
        const allowedTypes = /mp3|wav|m4a|webm|mp4|mpeg|mpga|oga|ogg/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only audio files are allowed!'));
        }
    }
});

// Multer error handling middleware
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ 
                message: 'File size too large. Maximum size is 25MB.' 
            });
        }
        return res.status(400).json({ 
            message: `Upload error: ${err.message}` 
        });
    }
    if (err) {
        return res.status(400).json({ 
            message: err.message || 'File upload error' 
        });
    }
    next();
};

// Route to upload and process audio using RevAI
router.post('/whisper', upload.single('audio'), handleMulterError, revaiController);

// Route to upload and process classroom audio (teachers and admins only)
router.post('/whisper/classroom', authenticateToken, upload.single('audio'), handleMulterError, classroomWhisperController);

// "Record Activity" upload (teachers + parents). Returns transcript for review; client must
// call /api/assessments/activity/accept to persist. Distributes to every supervised/linked child.
router.post('/whisper/activity', authenticateToken, upload.single('audio'), handleMulterError, activityRecordingController);

// Validate (and normalize) a custom activity label via LLM. Predefined activities bypass the LLM.
router.post('/activities/validate', authenticateToken, validateActivityController);

// ENACT mobile app integration: submit audio by parent email, auto-save (no review step)
router.post('/integrations/enact/submit', upload.single('audio'), handleMulterError, enactController);

// Route to get all assessments for a child
router.get('/assessments/child/:childId', authenticateToken, async (req, res) => {
    try {
        await purgeExpiredTranscripts();
        const { childId } = req.params;
        const user = req.user;

        if (user.role === 'parent') {
            const parent = await Parent.findById(user.id);
            if (!parent || !(await parentMayAccessChild(parent, childId))) {
                return res.status(403).json({ message: "You can only access your own children's transcripts" });
            }
        } else if (user.role === 'teacher') {
            const ok = await hasActiveTeacherChildGrant(user.id, childId);
            if (!ok) {
                return res.status(403).json({ message: "You do not have access to this child's assessments" });
            }
        } else if (user.role !== 'admin') {
            return res.status(403).json({ message: "Not allowed to view child transcripts" });
        }

        const query = { childId: toObjectId(childId) };
        if (user.role === 'parent' || user.role === 'teacher') {
            Object.assign(query, transcriptVisibilityFilter());
        }

        const assessments = await Assessment.find(query).sort({ date: -1 });
        res.status(200).json({ assessments });
    } catch (error) {
        console.error("Error fetching assessments:", error);
        res.status(500).json({ message: error.message });
    }
});

// Route to get latest assessment for a child
router.get('/assessments/child/:childId/latest', authenticateToken, async (req, res) => {
    try {
        await purgeExpiredTranscripts();
        const { childId } = req.params;
        const user = req.user;

        if (user.role === 'parent') {
            const parent = await Parent.findById(user.id);
            if (!parent || !(await parentMayAccessChild(parent, childId))) {
                return res.status(403).json({ message: "You can only access your own children's transcripts" });
            }
        } else if (user.role === 'teacher') {
            const ok = await hasActiveTeacherChildGrant(user.id, childId);
            if (!ok) {
                return res.status(403).json({ message: "You do not have access to this child's assessments" });
            }
        } else if (user.role !== 'admin') {
            return res.status(403).json({ message: "Not allowed to view child transcripts" });
        }

        const query = { childId: toObjectId(childId) };
        if (user.role === 'parent' || user.role === 'teacher') {
            Object.assign(query, transcriptVisibilityFilter());
        }

        const assessment = await Assessment.findOne(query).sort({ date: -1 });
        
        if (!assessment) {
            return res.status(404).json({ message: "No assessments found for this child" });
        }
        
        res.status(200).json({ assessment });
    } catch (error) {
        console.error("Error fetching latest assessment:", error);
        res.status(500).json({ message: error.message });
    }
});

// Accept "Record Activity" assessment and save one Assessment per supervised/linked child.
// Teachers fan out to children where leadTeacher === teacher.name; parents fan out to childIds.
router.post('/assessments/activity/accept', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
        const {
            audioFileName,
            transcript,
            keywordCounts,
            categoryWordCount,
            ragSegments,
            classificationMethod,
            uploadedBy,
            date,
            wordCount,
            durationSeconds,
            wordsPerMinute,
            categoryWPM,
            activity,
            activityContext,
        } = req.body || {};

        const finalActivity = String(activity || "").trim();
        if (!finalActivity) {
            return res.status(400).json({ message: "Activity is required." });
        }

        let expectedContext;
        let childTargets;
        let teacherDoc = null;
        if (user.role === "parent") {
            expectedContext = "home";
            const parent = await Parent.findById(user.id);
            if (!parent) return res.status(404).json({ message: "Parent not found" });
            const idStrs = await getResolvedChildIdStringsForParent(parent);
            if (idStrs.length === 0) {
                return res.status(400).json({ message: "No children linked to your account." });
            }
            const oids = idStrs.map((s) => new mongoose.Types.ObjectId(s));
            childTargets = await Child.find({ _id: { $in: oids } });
        } else if (user.role === "teacher") {
            expectedContext = "school";
            teacherDoc = await Teacher.findById(user.id);
            if (!teacherDoc) return res.status(404).json({ message: "Teacher not found" });
            childTargets = await Child.find({ leadTeacher: teacherDoc.name });
            if (childTargets.length === 0) {
                return res.status(400).json({ message: "No children assigned to you as lead teacher." });
            }
        } else {
            return res.status(403).json({ message: "Only parents and teachers can record activities." });
        }

        if (activityContext && activityContext !== expectedContext) {
            return res.status(400).json({
                message: `Activity context mismatch (expected ${expectedContext}).`,
            });
        }

        // Re-validate the activity server-side so an attacker can't bypass the LLM check.
        // Match against the predefined list for this exact context only.
        if (!isPredefinedActivity(finalActivity, expectedContext)) {
            const decision = await validateCustomActivity(finalActivity, expectedContext);
            if (!decision.accepted) {
                return res.status(400).json({
                    message: decision.reason || "Custom activity was not accepted for this context.",
                });
            }
        }

        const assessmentDate = date ? new Date(date) : new Date();
        if (isNaN(assessmentDate.getTime())) {
            return res.status(400).json({ message: "Invalid recording date" });
        }

        const base = {
            audioFileName: audioFileName || "",
            transcript: transcript || "",
            scienceTalk: 0,
            socialTalk: 0,
            literatureTalk: 0,
            languageDevelopment: 0,
            keywordCounts: keywordCounts || { science: 0, social: 0, literature: 0, language: 0 },
            categoryWordCount: categoryWordCount || { science: 0, social: 0, literature: 0, language: 0 },
            ragScores: null,
            ragSegments: ragSegments || null,
            classificationMethod: classificationMethod || "keyword-only",
            uploadedBy: uploadedBy || user.name || "Unknown",
            date: assessmentDate,
            transcriptExpiresAt: addOneMonth(assessmentDate),
            wordCount: wordCount ?? null,
            durationSeconds: durationSeconds ?? null,
            wordsPerMinute: wordsPerMinute ?? null,
            categoryWPM: categoryWPM ?? { science: null, social: null, literature: null, language: null },
            activity: finalActivity,
            activityContext: expectedContext,
        };

        const saved = await Promise.all(
            childTargets.map(async (child) => {
                const assessment = new Assessment({ ...base, childId: child._id });
                await assessment.save();
                return { assessmentId: assessment._id, childId: child._id, childName: child.name };
            })
        );

        // When a teacher records a classroom activity, also persist a TeacherAssessment so the
        // recording surfaces on the teacher's own profile alongside their classroom uploads.
        let teacherAssessmentRef = null;
        if (user.role === "teacher" && teacherDoc) {
            const teacherAssessment = new TeacherAssessment({
                teacherId: teacherDoc._id,
                date: base.date,
                audioFileName: base.audioFileName,
                transcript: base.transcript,
                transcriptExpiresAt: base.transcriptExpiresAt,
                scienceTalk: 0,
                socialTalk: 0,
                literatureTalk: 0,
                languageDevelopment: 0,
                keywordCounts: base.keywordCounts,
                categoryWordCount: base.categoryWordCount,
                ragScores: null,
                ragSegments: base.ragSegments,
                classificationMethod: base.classificationMethod,
                uploadedBy: base.uploadedBy,
                center: teacherDoc.center || null,
                activity: base.activity,
                activityContext: base.activityContext,
                wordCount: base.wordCount,
                durationSeconds: base.durationSeconds,
                wordsPerMinute: base.wordsPerMinute,
                categoryWPM: base.categoryWPM,
            });
            await teacherAssessment.save();
            teacherAssessmentRef = {
                assessmentId: teacherAssessment._id,
                teacherId: teacherDoc._id,
            };
        }

        await recomputeAndSaveChildrenCohortStats().catch((err) =>
            console.error("Failed to update children cohort stats after activity recording:", err)
        );

        if (teacherAssessmentRef) {
            await recomputeAndSaveTeachersCohortStats().catch((err) =>
                console.error("Failed to update teachers cohort stats after activity recording:", err)
            );
        }

        return res.status(201).json({
            message: `Activity recording saved for ${saved.length} child${saved.length === 1 ? "" : "ren"}.`,
            activity: finalActivity,
            activityContext: expectedContext,
            count: saved.length,
            assessments: saved,
            teacherAssessment: teacherAssessmentRef,
        });
    } catch (error) {
        console.error("Error saving activity assessment:", error);
        return res.status(500).json({ message: error.message });
    }
});

// Route to accept and save assessment after transcript review
router.post('/assessments/accept', async (req, res) => {
    try {
        const { childId, audioFileName, transcript, scienceTalk, socialTalk, literatureTalk, languageDevelopment, keywordCounts, categoryWordCount, ragScores, ragSegments, classificationMethod, uploadedBy, date, wordCount, durationSeconds, wordsPerMinute, categoryWPM } = req.body;

        if (!childId) {
            return res.status(400).json({ message: "Child ID is required" });
        }

        // Convert childId to ObjectId if it's a string
        const childIdObject = mongoose.Types.ObjectId.isValid(childId) 
            ? new mongoose.Types.ObjectId(childId) 
            : childId;

        // Create and save assessment
        const assessment = new Assessment({
            childId: childIdObject,
            audioFileName: audioFileName || '',
            transcript: transcript || '',
            scienceTalk: scienceTalk || 0,
            socialTalk: socialTalk || 0,
            literatureTalk: literatureTalk || 0,
            languageDevelopment: languageDevelopment || 0,
            keywordCounts: keywordCounts || {
                science: 0,
                social: 0,
                literature: 0,
                language: 0
            },
            categoryWordCount: categoryWordCount || {
                science: 0,
                social: 0,
                literature: 0,
                language: 0
            },
            ragScores: ragScores || null,
            ragSegments: ragSegments || null,
            classificationMethod: classificationMethod || 'keyword-only',
            uploadedBy: uploadedBy || "Unknown",
            date: date ? new Date(date) : new Date(),
            transcriptExpiresAt: addOneMonth(date ? new Date(date) : new Date()),
            wordCount: wordCount ?? null,
            durationSeconds: durationSeconds ?? null,
            wordsPerMinute: wordsPerMinute ?? null,
            categoryWPM: categoryWPM ?? { science: null, social: null, literature: null, language: null }
        });

        await assessment.save();
        console.log("✓ Assessment saved after user acceptance");
        console.log("Saved keywordCounts:", assessment.keywordCounts);
        console.log("Assessment ID:", assessment._id);
        console.log("Assessment date:", assessment.date);

        await recomputeAndSaveChildrenCohortStats().catch((err) => console.error("Failed to update children cohort stats:", err));

        res.status(201).json({
            message: "Assessment saved successfully",
            assessment
        });
    } catch (error) {
        console.error("Error saving assessment:", error);
        res.status(500).json({ message: error.message });
    }
});

// Route to delete a child assessment (recalculates cohort thresholds)
router.delete('/assessments/child/:assessmentId', authenticateToken, async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const user = req.user;

        if (!mongoose.Types.ObjectId.isValid(assessmentId)) {
            return res.status(400).json({ message: "Invalid assessment ID" });
        }

        const assessment = await Assessment.findById(assessmentId);
        if (!assessment) {
            return res.status(404).json({ message: "Assessment not found" });
        }

        // Admin can delete any; parent can only delete assessments for their linked children
        if (user.role === 'parent') {
            const parent = await Parent.findById(user.id);
            if (!parent || !(await parentMayAccessChild(parent, assessment.childId))) {
                return res.status(403).json({ message: "You do not have permission to delete this assessment" });
            }
        } else if (user.role !== 'admin') {
            return res.status(403).json({ message: "You do not have permission to delete this assessment" });
        }

        await Assessment.findByIdAndDelete(assessmentId);
        console.log("✓ Child assessment deleted:", assessmentId);

        await recomputeAndSaveChildrenCohortStats().catch((err) => console.error("Failed to update children cohort stats:", err));

        res.status(200).json({ message: "Assessment deleted successfully" });
    } catch (error) {
        console.error("Error deleting child assessment:", error);
        res.status(500).json({ message: error.message });
    }
});

// Route to get cohort WPM statistics for teachers (stored, same for all teachers; recalculated on teacher transcript accept)
router.get('/assessments/cohort-stats/teachers', authenticateToken, async (req, res) => {
    try {
        const result = await getCohortStats('teachers');
        res.status(200).json({ cohortStats: result || {} });
    } catch (error) {
        console.error("Error fetching teacher cohort stats:", error);
        res.status(500).json({ message: error.message });
    }
});

// Route to get cohort WPM statistics for children (stored, same for all children; recalculated on child transcript accept)
// No auth required - returns aggregate stats only, used for dial zones on child data page
router.get('/assessments/cohort-stats/children', async (req, res) => {
    try {
        const result = await getCohortStats('children');
        res.status(200).json({ cohortStats: result || {} });
    } catch (error) {
        console.error("Error fetching children cohort stats:", error);
        res.status(500).json({ message: error.message });
    }
});

// Route to get all teacher assessments (teachers: own; parents: with active grant; admins: all)
router.get('/assessments/teacher/:teacherId', authenticateToken, async (req, res) => {
    try {
        await purgeExpiredTranscripts();
        const { teacherId } = req.params;
        const user = req.user;

        if (user.role === 'admin') {
            const assessments = await TeacherAssessment.find({ teacherId }).sort({ date: -1 });
            return res.status(200).json({ assessments });
        }

        if (user.role === 'teacher') {
            if (String(user.id) !== String(teacherId)) {
                return res.status(403).json({ message: "You can only access your own assessments" });
            }
            const assessments = await TeacherAssessment.find({
                teacherId: toObjectId(teacherId),
                ...transcriptVisibilityFilter(),
            }).sort({ date: -1 });
            return res.status(200).json({ assessments });
        }

        if (user.role === 'parent') {
            const parent = await Parent.findById(user.id);
            if (!parent) {
                return res.status(404).json({ message: "Parent not found" });
            }
            const childIdStrs = await getResolvedChildIdStringsForParent(parent);
            const ok = await hasActiveParentTeacherGrantForAnyChild(parent._id, teacherId, childIdStrs);
            if (!ok) {
                return res.status(403).json({ message: "You do not have access to this teacher's assessments" });
            }
            const assessments = await TeacherAssessment.find({
                teacherId: toObjectId(teacherId),
                ...transcriptVisibilityFilter(),
            }).sort({ date: -1 });
            return res.status(200).json({ assessments });
        }

        return res.status(403).json({ message: "Not allowed to access teacher transcripts" });
    } catch (error) {
        console.error("Error fetching teacher assessments:", error);
        res.status(500).json({ message: error.message });
    }
});

// Route to get latest teacher assessment
router.get('/assessments/teacher/:teacherId/latest', authenticateToken, async (req, res) => {
    try {
        await purgeExpiredTranscripts();
        const { teacherId } = req.params;
        const user = req.user;

        const buildTeacherTranscriptQuery = (tid) => ({
            teacherId: toObjectId(tid),
            ...transcriptVisibilityFilter(),
        });

        if (user.role === 'admin') {
            const assessment = await TeacherAssessment.findOne({ teacherId }).sort({ date: -1 });
            if (!assessment) {
                return res.status(404).json({ message: "No assessments found for this teacher" });
            }
            return res.status(200).json({ assessment });
        }

        if (user.role === 'teacher') {
            if (String(user.id) !== String(teacherId)) {
                return res.status(403).json({ message: "You can only access your own assessments" });
            }
            const assessment = await TeacherAssessment.findOne(buildTeacherTranscriptQuery(teacherId)).sort({ date: -1 });
            if (!assessment) {
                return res.status(404).json({ message: "No assessments found for this teacher" });
            }
            return res.status(200).json({ assessment });
        }

        if (user.role === 'parent') {
            const parent = await Parent.findById(user.id);
            if (!parent) {
                return res.status(404).json({ message: "Parent not found" });
            }
            const childIdStrs = await getResolvedChildIdStringsForParent(parent);
            const ok = await hasActiveParentTeacherGrantForAnyChild(parent._id, teacherId, childIdStrs);
            if (!ok) {
                return res.status(403).json({ message: "You do not have access to this teacher's assessments" });
            }
            const assessment = await TeacherAssessment.findOne(buildTeacherTranscriptQuery(teacherId)).sort({ date: -1 });
            if (!assessment) {
                return res.status(404).json({ message: "No assessments found for this teacher" });
            }
            return res.status(200).json({ assessment });
        }

        return res.status(403).json({ message: "Not allowed to access teacher transcripts" });
    } catch (error) {
        console.error("Error fetching latest teacher assessment:", error);
        res.status(500).json({ message: error.message });
    }
});

// Route to accept and save teacher assessment after transcript review
router.post('/assessments/teacher/accept', authenticateToken, async (req, res) => {
    try {
        const { teacherId, audioFileName, transcript, scienceTalk, socialTalk, literatureTalk, languageDevelopment, keywordCounts, categoryWordCount, ragScores, ragSegments, classificationMethod, uploadedBy, date, center, wordCount, durationSeconds, wordsPerMinute, categoryWPM } = req.body;

        if (!teacherId) {
            return res.status(400).json({ message: "Teacher ID is required" });
        }

        const teacherIdObject = mongoose.Types.ObjectId.isValid(teacherId)
            ? new mongoose.Types.ObjectId(teacherId)
            : teacherId;

        const assessment = new TeacherAssessment({
            teacherId: teacherIdObject,
            audioFileName: audioFileName || '',
            transcript: transcript || '',
            scienceTalk: scienceTalk || 0,
            socialTalk: socialTalk || 0,
            literatureTalk: literatureTalk || 0,
            languageDevelopment: languageDevelopment || 0,
            keywordCounts: keywordCounts || {
                science: 0,
                social: 0,
                literature: 0,
                language: 0
            },
            categoryWordCount: categoryWordCount || {
                science: 0,
                social: 0,
                literature: 0,
                language: 0
            },
            ragScores: ragScores || null,
            ragSegments: ragSegments || null,
            classificationMethod: classificationMethod || 'keyword-only',
            uploadedBy: uploadedBy || "Unknown",
            date: date ? new Date(date) : new Date(),
            transcriptExpiresAt: addOneMonth(date ? new Date(date) : new Date()),
            center: center || null,
            wordCount: wordCount ?? null,
            durationSeconds: durationSeconds ?? null,
            wordsPerMinute: wordsPerMinute ?? null,
            categoryWPM: categoryWPM ?? { science: null, social: null, literature: null, language: null }
        });

        await assessment.save();
        console.log("Teacher assessment saved after user acceptance");

        await recomputeAndSaveTeachersCohortStats().catch((err) => console.error("Failed to update teachers cohort stats:", err));

        res.status(201).json({
            message: "Teacher assessment saved successfully",
            assessment
        });
    } catch (error) {
        console.error("Error saving teacher assessment:", error);
        res.status(500).json({ message: error.message });
    }
});

// Route to delete a teacher assessment (recalculates cohort thresholds)
router.delete('/assessments/teacher/:assessmentId', authenticateToken, async (req, res) => {
    try {
        const { assessmentId } = req.params;
        const user = req.user;

        if (!mongoose.Types.ObjectId.isValid(assessmentId)) {
            return res.status(400).json({ message: "Invalid assessment ID" });
        }

        const assessment = await TeacherAssessment.findById(assessmentId);
        if (!assessment) {
            return res.status(404).json({ message: "Assessment not found" });
        }

        // Admin can delete any; teacher can only delete their own
        const teacherIdStr = assessment.teacherId?.toString();
        const userIdStr = user.id?.toString?.() || (typeof user.id === 'string' ? user.id : null);
        if (user.role !== 'admin' && (user.role !== 'teacher' || userIdStr !== teacherIdStr)) {
            return res.status(403).json({ message: "You do not have permission to delete this assessment" });
        }

        await TeacherAssessment.findByIdAndDelete(assessmentId);
        console.log("✓ Teacher assessment deleted:", assessmentId);

        await recomputeAndSaveTeachersCohortStats().catch((err) => console.error("Failed to update teachers cohort stats:", err));

        res.status(200).json({ message: "Assessment deleted successfully" });
    } catch (error) {
        console.error("Error deleting teacher assessment:", error);
        res.status(500).json({ message: error.message });
    }
});

export default router;