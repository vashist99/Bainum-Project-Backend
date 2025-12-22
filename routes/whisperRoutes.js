import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import mongoose from 'mongoose';
import revaiController from '../controllers/whisperController.js';
import Assessment from '../models/Assessment.js';

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
        const { childId, audioFileName, transcript, scienceTalk, socialTalk, literatureTalk, languageDevelopment, keywordCounts, uploadedBy, date } = req.body;

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
            uploadedBy: uploadedBy || "Unknown",
            date: date ? new Date(date) : new Date()
        });

        await assessment.save();
        console.log("✓ Assessment saved after user acceptance");
        console.log("Saved keywordCounts:", assessment.keywordCounts);
        console.log("Assessment ID:", assessment._id);
        console.log("Assessment date:", assessment.date);

        res.status(201).json({
            message: "Assessment saved successfully",
            assessment
        });
    } catch (error) {
        console.error("Error saving assessment:", error);
        res.status(500).json({ message: error.message });
    }
});

export default router;