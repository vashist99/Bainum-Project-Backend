import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import mongoose from 'mongoose';
import revaiController from '../controllers/whisperController.js';
import classroomWhisperController from '../controllers/classroomWhisperController.js';
import Assessment from '../models/Assessment.js';
import TeacherAssessment from '../models/TeacherAssessment.js';
import authenticateToken from '../middleware/authMiddleware.js';
import { recomputeAndSaveChildrenCohortStats, recomputeAndSaveTeachersCohortStats, getCohortStats } from '../lib/cohortStatsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

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

// Route to get all assessments for a child
router.get('/assessments/child/:childId', async (req, res) => {
    try {
        const { childId } = req.params;
        const assessments = await Assessment.find({ childId }).sort({ date: -1 });
        res.status(200).json({ assessments });
    } catch (error) {
        console.error("Error fetching assessments:", error);
        res.status(500).json({ message: error.message });
    }
});

// Route to get latest assessment for a child
router.get('/assessments/child/:childId/latest', async (req, res) => {
    try {
        const { childId } = req.params;
        const assessment = await Assessment.findOne({ childId }).sort({ date: -1 });
        
        if (!assessment) {
            return res.status(404).json({ message: "No assessments found for this child" });
        }
        
        res.status(200).json({ assessment });
    } catch (error) {
        console.error("Error fetching latest assessment:", error);
        res.status(500).json({ message: error.message });
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

        // Admin can delete any; parent can only delete their own child's assessments
        const childIdStr = assessment.childId?.toString();
        const userChildId = user.childId?.toString?.() || (typeof user.childId === 'string' ? user.childId : null);
        if (user.role !== 'admin' && (user.role !== 'parent' || userChildId !== childIdStr)) {
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

// Route to get all teacher assessments (teachers can only access their own)
router.get('/assessments/teacher/:teacherId', authenticateToken, async (req, res) => {
    try {
        const { teacherId } = req.params;
        if (req.user.role === 'teacher' && String(req.user.id) !== String(teacherId)) {
            return res.status(403).json({ message: "You can only access your own assessments" });
        }
        const assessments = await TeacherAssessment.find({ teacherId }).sort({ date: -1 });
        res.status(200).json({ assessments });
    } catch (error) {
        console.error("Error fetching teacher assessments:", error);
        res.status(500).json({ message: error.message });
    }
});

// Route to get latest teacher assessment (teachers can only access their own)
router.get('/assessments/teacher/:teacherId/latest', authenticateToken, async (req, res) => {
    try {
        const { teacherId } = req.params;
        if (req.user.role === 'teacher' && String(req.user.id) !== String(teacherId)) {
            return res.status(403).json({ message: "You can only access your own assessments" });
        }
        const assessment = await TeacherAssessment.findOne({ teacherId }).sort({ date: -1 });

        if (!assessment) {
            return res.status(404).json({ message: "No assessments found for this teacher" });
        }

        res.status(200).json({ assessment });
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