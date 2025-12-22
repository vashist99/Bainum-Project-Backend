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
    uploadedBy: { 
        type: String, 
        required: false 
    }
}, {
    timestamps: true
});

const Assessment = mongoose.model("Assessment", assessmentSchema);

export default Assessment;

