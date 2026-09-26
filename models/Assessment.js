import mongoose from "mongoose";

const assessmentSchema = new mongoose.Schema({
    childId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Child",
        required: true
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
    /** Recorded activity context (e.g. "Mealtime", "Reading", or a validated custom activity). */
    activity: {
        type: String,
        required: false,
        trim: true
    },
    /** Where the activity took place — set by the recording controller. */
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
    },
    observationNote: {
        text: { type: String, default: "" },
        authorName: { type: String, default: "" },
        authorId: { type: mongoose.Schema.Types.ObjectId, default: null },
        updatedAt: { type: Date, default: null },
    },
    observationComments: {
        type: [
            {
                text: { type: String, required: true, maxlength: 4000 },
                authorName: { type: String, default: "" },
                authorId: { type: mongoose.Schema.Types.ObjectId, default: null },
                createdAt: { type: Date, default: Date.now },
            },
        ],
        default: [],
    },
    hidden: { type: Boolean, default: false, index: true },
    recordedById: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
});

const Assessment = mongoose.model("Assessment", assessmentSchema);
export default Assessment;
