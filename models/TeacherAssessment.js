import mongoose from "mongoose";

const teacherAssessmentSchema = new mongoose.Schema({
    teacherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Teacher",
        required: true
    },
    // Set when this recording was made from a classroom homepage. teacherId is
    // whoever recorded (lead or assistant).
    classroomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Classroom",
        required: false,
        index: true,
    },
    date: { 
        type: Date, 
        default: Date.now 
    },
    audioFileName: { 
        type: String, 
        required: false 
    },
    transcript: { 
        type: String, 
        required: false 
    },
    // Transcript text is retained for one year (365 days from recording
    // date); WPM and category metrics are kept indefinitely. Stamped at
    // write time via transcriptExpiryFrom() in backend/lib/transcriptRetention.js.
    transcriptExpiresAt: {
        type: Date,
        required: false,
        index: true,
    },
    scienceTalk: { 
        type: Number, 
        default: 0,
        min: 0,
        max: 100
    },
    socialTalk: { 
        type: Number, 
        default: 0,
        min: 0,
        max: 100
    },
    literatureTalk: { 
        type: Number, 
        default: 0,
        min: 0,
        max: 100
    },
    languageDevelopment: { 
        type: Number, 
        default: 0,
        min: 0,
        max: 100
    },
    keywordCounts: {
        science: { type: Number, default: 0 },
        social: { type: Number, default: 0 },
        literature: { type: Number, default: 0 },
        language: { type: Number, default: 0 }
    },
    categoryWordCount: {
        science: { type: Number, default: 0 },
        social: { type: Number, default: 0 },
        literature: { type: Number, default: 0 },
        language: { type: Number, default: 0 }
    },
    ragScores: {
        type: mongoose.Schema.Types.Mixed,
        required: false
    },
    ragSegments: {
        type: [mongoose.Schema.Types.Mixed],
        required: false
    },
    classificationMethod: {
        type: String,
        enum: ['keyword-only', 'rag'],
        default: 'keyword-only'
    },
    uploadedBy: { 
        type: String, 
        required: false 
    },
    center: {
        type: String,
        required: false
    },
    /** Recorded activity context (e.g. "Mealtime", "Reading", or a validated custom activity). */
    activity: {
        type: String,
        required: false,
        trim: true
    },
    /** Where the activity took place — always "school" for teacher assessments. */
    activityContext: {
        type: String,
        enum: ['school', 'home'],
        required: false
    },
    /** Recording location (predefined catalog entry or a validated custom location). */
    location: {
        type: String,
        required: false,
        trim: true
    },
    wordCount: { type: Number, default: null },
    durationSeconds: { type: Number, default: null },
    wordsPerMinute: { type: Number, default: null },
    categoryWPM: {
        science: { type: Number, default: null },
        social: { type: Number, default: null },
        literature: { type: Number, default: null },
        language: { type: Number, default: null }
    }
}, {
    timestamps: true
});

const TeacherAssessment = mongoose.model("TeacherAssessment", teacherAssessmentSchema);

export default TeacherAssessment;
