import dotenv from "dotenv";
import OpenAI from "openai";
import crypto from "crypto";

dotenv.config();

class EmbeddingService {
    constructor() {
        this.openai = null;
        this.model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
        this.cache = new Map(); // In-memory cache for current session
        
        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        } else {
            console.warn("⚠️  OPENAI_API_KEY not set - embedding service will not work");
        }
    }

    /**
     * Generate a hash key for caching
     */
    _generateCacheKey(text) {
        return crypto.createHash('sha256').update(text.toLowerCase().trim()).digest('hex');
    }

    /**
     * Generate embedding for a text string
     * @param {string} text - Text to generate embedding for
     * @param {boolean} useCache - Whether to use cached embeddings (default: true)
     * @returns {Promise<number[]>} Embedding vector
     */
    async generateEmbedding(text, useCache = true) {
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            throw new Error("Text must be a non-empty string");
        }

        if (!this.openai) {
            throw new Error("OpenAI API key not configured");
        }

        const normalizedText = text.trim();
        const cacheKey = this._generateCacheKey(normalizedText);

        // Check in-memory cache first
        if (useCache && this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        try {
            const response = await this.openai.embeddings.create({
                model: this.model,
                input: normalizedText,
            });

            const embedding = response.data[0].embedding;

            // Cache the embedding
            if (useCache) {
                this.cache.set(cacheKey, embedding);
            }

            return embedding;
        } catch (error) {
            console.error("Error generating embedding:", error);
            throw new Error(`Failed to generate embedding: ${error.message}`);
        }
    }

    /**
     * Generate embeddings for multiple texts in batch
     * @param {string[]} texts - Array of texts to generate embeddings for
     * @param {boolean} useCache - Whether to use cached embeddings (default: true)
     * @returns {Promise<number[][]>} Array of embedding vectors
     */
    async generateEmbeddingsBatch(texts, useCache = true) {
        if (!Array.isArray(texts) || texts.length === 0) {
            throw new Error("Texts must be a non-empty array");
        }

        if (!this.openai) {
            throw new Error("OpenAI API key not configured");
        }

        // Filter out empty texts and check cache
        const validTexts = texts.filter(t => t && typeof t === 'string' && t.trim().length > 0);
        const normalizedTexts = validTexts.map(t => t.trim());
        
        const results = [];
        const textsToFetch = [];
        const indicesToFetch = [];

        for (let i = 0; i < normalizedTexts.length; i++) {
            const text = normalizedTexts[i];
            const cacheKey = this._generateCacheKey(text);

            if (useCache && this.cache.has(cacheKey)) {
                results[i] = this.cache.get(cacheKey);
            } else {
                textsToFetch.push(text);
                indicesToFetch.push(i);
            }
        }

        // Fetch embeddings for texts not in cache
        if (textsToFetch.length > 0) {
            try {
                const response = await this.openai.embeddings.create({
                    model: this.model,
                    input: textsToFetch,
                });

                // Store results and cache them
                response.data.forEach((item, idx) => {
                    const originalIndex = indicesToFetch[idx];
                    results[originalIndex] = item.embedding;
                    
                    if (useCache) {
                        const cacheKey = this._generateCacheKey(textsToFetch[idx]);
                        this.cache.set(cacheKey, item.embedding);
                    }
                });
            } catch (error) {
                console.error("Error generating batch embeddings:", error);
                throw new Error(`Failed to generate batch embeddings: ${error.message}`);
            }
        }

        return results;
    }

    /**
     * Clear the in-memory cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Get cache size
     */
    getCacheSize() {
        return this.cache.size;
    }
}

// Export singleton instance
const embeddingService = new EmbeddingService();
export default embeddingService;
