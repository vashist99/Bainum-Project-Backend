import mongoose from "mongoose";

const cohortStatsSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        unique: true,
        enum: ["teachers", "children"]
    },
    stats: {
        type: mongoose.Schema.Types.Mixed,
        required: true,
        default: () => ({ science: {}, social: {}, literature: {}, language: {} })
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

cohortStatsSchema.index({ type: 1 });

const CohortStats = mongoose.model("CohortStats", cohortStatsSchema);
export default CohortStats;
