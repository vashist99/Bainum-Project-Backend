import dotenv from "dotenv";
import KnowledgeBaseEmbedding from "../models/KnowledgeBaseEmbedding.js";
import embeddingService from "./embeddingService.js";

dotenv.config();

class VectorStore {
    /**
     * Calculate cosine similarity between two vectors
     * @param {number[]} vecA - First vector
     * @param {number[]} vecB - Second vector
     * @returns {number} Cosine similarity score (0-1)
     */
    cosineSimilarity(vecA, vecB) {
        if (vecA.length !== vecB.length) {
            throw new Error("Vectors must have the same length");
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);

        if (normA === 0 || normB === 0) {
            return 0;
        }

        return dotProduct / (normA * normB);
    }

    /**
     * Store an embedding in the database
     * @param {string} text - Original text
     * @param {string} category - Category (science, social, literature, language)
     * @param {number[]} embedding - Embedding vector
     * @param {object} metadata - Additional metadata
     * @returns {Promise<Object>} Saved document
     */
    async storeEmbedding(text, category, embedding, metadata = {}) {
        try {
            // Check if embedding already exists for this text and category
            const existing = await KnowledgeBaseEmbedding.findOne({
                text: text.trim(),
                category: category
            });

            if (existing) {
                // Update existing embedding
                existing.embedding = embedding;
                existing.metadata = { ...existing.metadata, ...metadata };
                return await existing.save();
            } else {
                // Create new embedding
                const doc = new KnowledgeBaseEmbedding({
                    text: text.trim(),
                    category: category,
                    embedding: embedding,
                    metadata: metadata
                });
                return await doc.save();
            }
        } catch (error) {
            console.error("Error storing embedding:", error);
            throw new Error(`Failed to store embedding: ${error.message}`);
        }
    }

    /**
     * Find top-K most similar embeddings for a given query embedding
     * @param {number[]} queryEmbedding - Query embedding vector
     * @param {string} category - Category to search in (optional, searches all if not provided)
     * @param {number} topK - Number of results to return (default: 5)
     * @returns {Promise<Array>} Array of {text, category, similarity, metadata} objects
     */
    async findSimilar(queryEmbedding, category = null, topK = 5) {
        try {
            // Build query
            const query = {};
            if (category) {
                query.category = category;
            }

            // Fetch all embeddings for the category (or all if no category specified)
            const embeddings = await KnowledgeBaseEmbedding.find(query);

            if (embeddings.length === 0) {
                return [];
            }

            // Calculate similarity scores
            const similarities = embeddings.map(doc => ({
                text: doc.text,
                category: doc.category,
                similarity: this.cosineSimilarity(queryEmbedding, doc.embedding),
                metadata: doc.metadata || {}
            }));

            // Sort by similarity (descending) and return top-K
            similarities.sort((a, b) => b.similarity - a.similarity);
            return similarities.slice(0, topK);
        } catch (error) {
            console.error("Error finding similar embeddings:", error);
            throw new Error(`Failed to find similar embeddings: ${error.message}`);
        }
    }

    /**
     * Find top-K most similar embeddings for each category
     * @param {number[]} queryEmbedding - Query embedding vector
     * @param {number} topK - Number of results per category (default: 5)
     * @returns {Promise<Object>} Object with category keys and arrays of similar items
     */
    async findSimilarByCategory(queryEmbedding, topK = 5) {
        const categories = ['science', 'social', 'literature', 'language'];
        const results = {};

        for (const category of categories) {
            results[category] = await this.findSimilar(queryEmbedding, category, topK);
        }

        return results;
    }

    /**
     * Get all embeddings for a specific category
     * @param {string} category - Category to retrieve
     * @returns {Promise<Array>} Array of embedding documents
     */
    async getCategoryEmbeddings(category) {
        try {
            return await KnowledgeBaseEmbedding.find({ category: category });
        } catch (error) {
            console.error("Error getting category embeddings:", error);
            throw new Error(`Failed to get category embeddings: ${error.message}`);
        }
    }

    /**
     * Delete all embeddings (useful for re-initialization)
     * @returns {Promise<Object>} Deletion result
     */
    async clearAll() {
        try {
            return await KnowledgeBaseEmbedding.deleteMany({});
        } catch (error) {
            console.error("Error clearing embeddings:", error);
            throw new Error(`Failed to clear embeddings: ${error.message}`);
        }
    }

    /**
     * Get count of embeddings by category
     * @returns {Promise<Object>} Object with category counts
     */
    async getCounts() {
        try {
            const categories = ['science', 'social', 'literature', 'language'];
            const counts = {};

            for (const category of categories) {
                counts[category] = await KnowledgeBaseEmbedding.countDocuments({ category });
            }

            return counts;
        } catch (error) {
            console.error("Error getting counts:", error);
            throw new Error(`Failed to get counts: ${error.message}`);
        }
    }
}

// Export singleton instance
const vectorStore = new VectorStore();
export default vectorStore;
