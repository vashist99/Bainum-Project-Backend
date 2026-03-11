import mongoose from "mongoose";

const knowledgeBaseEmbeddingSchema = new mongoose.Schema({
    text: {
        type: String,
        required: true,
        index: true
    },
    category: {
        type: String,
        required: true,
        enum: ['science', 'social', 'literature', 'language'],
        index: true
    },
    embedding: {
        type: [Number],
        required: true
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    source: {
        type: String,
        default: 'knowledgeBase'
    }
}, {
    timestamps: true
});

// Compound index for category and text searches (category index is via field-level index: true)
knowledgeBaseEmbeddingSchema.index({ category: 1, text: 1 });

const KnowledgeBaseEmbedding = mongoose.model("KnowledgeBaseEmbedding", knowledgeBaseEmbeddingSchema);

export default KnowledgeBaseEmbedding;
