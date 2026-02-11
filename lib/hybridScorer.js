import dotenv from "dotenv";

dotenv.config();

class HybridScorer {
    constructor() {
        // Get weights from environment or use defaults
        this.ragWeight = parseFloat(process.env.RAG_WEIGHT || "0.7");
        this.keywordWeight = parseFloat(process.env.KEYWORD_WEIGHT || "0.3");
        
        // Normalize weights to ensure they sum to 1
        const totalWeight = this.ragWeight + this.keywordWeight;
        if (totalWeight > 0) {
            this.ragWeight = this.ragWeight / totalWeight;
            this.keywordWeight = this.keywordWeight / totalWeight;
        } else {
            // Fallback if both are 0
            this.ragWeight = 0.7;
            this.keywordWeight = 0.3;
        }
    }

    /**
     * Combine RAG scores with keyword-based scores
     * @param {Object} ragScores - Scores from RAG classifier
     * @param {Object} keywordScores - Scores from keyword analysis
     * @returns {Object} Combined scores for each category
     */
    combineScores(ragScores, keywordScores) {
        // Validate inputs
        if (!ragScores || typeof ragScores !== 'object') {
            ragScores = {
                scienceTalk: 0,
                socialTalk: 0,
                literatureTalk: 0,
                languageDevelopment: 0
            };
        }

        if (!keywordScores || typeof keywordScores !== 'object') {
            keywordScores = {
                scienceTalk: 0,
                socialTalk: 0,
                literatureTalk: 0,
                languageDevelopment: 0
            };
        }

        // Combine scores using weighted average
        const combined = {
            scienceTalk: this._combineSingleScore(
                ragScores.scienceTalk || 0,
                keywordScores.scienceTalk || 0
            ),
            socialTalk: this._combineSingleScore(
                ragScores.socialTalk || 0,
                keywordScores.socialTalk || 0
            ),
            literatureTalk: this._combineSingleScore(
                ragScores.literatureTalk || 0,
                keywordScores.literatureTalk || 0
            ),
            languageDevelopment: this._combineSingleScore(
                ragScores.languageDevelopment || 0,
                keywordScores.languageDevelopment || 0
            )
        };

        return combined;
    }

    /**
     * Combine a single score from two sources
     * @param {number} ragScore - RAG score (0-100)
     * @param {number} keywordScore - Keyword score (0-100)
     * @returns {number} Combined score (0-100)
     */
    _combineSingleScore(ragScore, keywordScore) {
        // Normalize scores to 0-100 range
        const normalizedRag = Math.max(0, Math.min(100, ragScore || 0));
        const normalizedKeyword = Math.max(0, Math.min(100, keywordScore || 0));

        // Calculate weighted average
        const combined = (normalizedRag * this.ragWeight) + (normalizedKeyword * this.keywordWeight);

        // Round to nearest integer
        return Math.round(combined);
    }

    /**
     * Get current weights
     * @returns {Object} Current RAG and keyword weights
     */
    getWeights() {
        return {
            ragWeight: this.ragWeight,
            keywordWeight: this.keywordWeight
        };
    }

    /**
     * Update weights (useful for testing or dynamic adjustment)
     * @param {number} ragWeight - New RAG weight
     * @param {number} keywordWeight - New keyword weight
     */
    setWeights(ragWeight, keywordWeight) {
        const totalWeight = ragWeight + keywordWeight;
        if (totalWeight > 0) {
            this.ragWeight = ragWeight / totalWeight;
            this.keywordWeight = keywordWeight / totalWeight;
        }
    }
}

// Export singleton instance
const hybridScorer = new HybridScorer();
export default hybridScorer;
