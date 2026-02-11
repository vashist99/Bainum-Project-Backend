import dotenv from "dotenv";
import OpenAI from "openai";
import embeddingService from "./embeddingService.js";
import vectorStore from "./vectorStore.js";

dotenv.config();

class RAGClassifier {
    constructor() {
        this.openai = null;
        this.classificationModel = process.env.OPENAI_CLASSIFICATION_MODEL || "gpt-4o-mini";
        this.topK = parseInt(process.env.RAG_TOP_K || "5", 10);
        
        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
        } else {
            console.warn("⚠️  OPENAI_API_KEY not set - RAG classifier will not work");
        }
    }

    /**
     * Classify a transcript using RAG pipeline
     * @param {string} transcript - Transcript text to classify
     * @returns {Promise<Object>} Scores for each category (0-100)
     */
    async classify(transcript) {
        if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
            console.warn("Empty transcript provided to RAG classifier");
            return {
                scienceTalk: 0,
                socialTalk: 0,
                literatureTalk: 0,
                languageDevelopment: 0
            };
        }

        if (!this.openai) {
            throw new Error("OpenAI API key not configured");
        }

        try {
            // Step 1: Generate embedding for the transcript
            const transcriptEmbedding = await embeddingService.generateEmbedding(transcript);

            // Step 2: Retrieve similar examples for each category
            const similarExamples = await vectorStore.findSimilarByCategory(transcriptEmbedding, this.topK);

            // Step 3: Build RAG prompt with retrieved context
            const prompt = this._buildPrompt(transcript, similarExamples);

            // Step 4: Use LLM to classify
            const scores = await this._classifyWithLLM(prompt, transcript);

            return scores;
        } catch (error) {
            console.error("Error in RAG classification:", error);
            // Return zero scores on error (caller can fall back to keyword-based)
            return {
                scienceTalk: 0,
                socialTalk: 0,
                literatureTalk: 0,
                languageDevelopment: 0
            };
        }
    }

    /**
     * Build RAG prompt with retrieved examples
     * @param {string} transcript - Original transcript
     * @param {Object} similarExamples - Similar examples by category
     * @returns {string} Formatted prompt
     */
    _buildPrompt(transcript, similarExamples) {
        let prompt = `You are an expert in analyzing early childhood language development transcripts. Your task is to classify a transcript into four categories and provide scores from 0-100 for each category.

Categories:
1. Science Talk: Discussions about scientific concepts, observations, experiments, and natural phenomena
2. Social Talk: Communication about feelings, relationships, social interactions, sharing, and helping
3. Literature Talk: Storytelling, narrative language, imaginative play, and references to books/stories
4. Language Development: Discussions about words, communication, vocabulary, grammar, reading, and writing

Here are example transcripts for each category to guide your classification:

`;

        // Add examples for each category
        const categories = [
            { key: 'science', name: 'Science Talk' },
            { key: 'social', name: 'Social Talk' },
            { key: 'literature', name: 'Literature Talk' },
            { key: 'language', name: 'Language Development' }
        ];

        for (const { key, name } of categories) {
            const examples = similarExamples[key] || [];
            if (examples.length > 0) {
                prompt += `${name} Examples:\n`;
                examples.forEach((ex, idx) => {
                    prompt += `${idx + 1}. "${ex.text}" (similarity: ${(ex.similarity * 100).toFixed(1)}%)\n`;
                });
                prompt += `\n`;
            }
        }

        prompt += `Now, analyze the following transcript and provide scores (0-100) for each category. Consider the context, vocabulary, and themes present in the transcript.

Transcript to analyze:
"${transcript}"

Provide your response as a JSON object with the following format:
{
  "scienceTalk": <number 0-100>,
  "socialTalk": <number 0-100>,
  "literatureTalk": <number 0-100>,
  "languageDevelopment": <number 0-100>
}

Only respond with the JSON object, no additional text.`;

        return prompt;
    }

    /**
     * Classify transcript using LLM
     * @param {string} prompt - Full RAG prompt
     * @param {string} transcript - Original transcript (for fallback)
     * @returns {Promise<Object>} Scores for each category
     */
    async _classifyWithLLM(prompt, transcript) {
        try {
            const response = await this.openai.chat.completions.create({
                model: this.classificationModel,
                messages: [
                    {
                        role: "system",
                        content: "You are an expert in early childhood language development analysis. Always respond with valid JSON only."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.3, // Lower temperature for more consistent results
                max_tokens: 200
            });

            const content = response.choices[0]?.message?.content?.trim();
            
            if (!content) {
                throw new Error("Empty response from LLM");
            }

            // Extract JSON from response (handle cases where LLM adds extra text)
            let jsonStr = content;
            
            // Try to extract JSON if wrapped in markdown code blocks
            const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1];
            } else {
                // Try to find JSON object in the response
                const jsonObjectMatch = content.match(/\{[\s\S]*\}/);
                if (jsonObjectMatch) {
                    jsonStr = jsonObjectMatch[0];
                }
            }

            const scores = JSON.parse(jsonStr);

            // Validate and normalize scores
            return {
                scienceTalk: this._normalizeScore(scores.scienceTalk),
                socialTalk: this._normalizeScore(scores.socialTalk),
                literatureTalk: this._normalizeScore(scores.literatureTalk),
                languageDevelopment: this._normalizeScore(scores.languageDevelopment)
            };
        } catch (error) {
            console.error("Error in LLM classification:", error);
            // Return zero scores on error
            return {
                scienceTalk: 0,
                socialTalk: 0,
                literatureTalk: 0,
                languageDevelopment: 0
            };
        }
    }

    /**
     * Classify transcript and return annotated segments
     * @param {string} transcript - Transcript text to classify
     * @returns {Promise<Object>} Object with scores and annotated segments
     */
    async classifyWithSegments(transcript) {
        if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
            return {
                scores: {
                    scienceTalk: 0,
                    socialTalk: 0,
                    literatureTalk: 0,
                    languageDevelopment: 0
                },
                segments: []
            };
        }

        if (!this.openai) {
            throw new Error("OpenAI API key not configured");
        }

        try {
            // Step 1: Generate embedding for the transcript
            const transcriptEmbedding = await embeddingService.generateEmbedding(transcript);

            // Step 2: Retrieve similar examples for each category
            const similarExamples = await vectorStore.findSimilarByCategory(transcriptEmbedding, this.topK);

            // Step 3: Build enhanced prompt that asks for segment identification
            const prompt = this._buildSegmentPrompt(transcript, similarExamples);

            // Step 4: Use LLM to classify and identify segments
            const result = await this._classifyWithSegmentsLLM(prompt, transcript);

            return result;
        } catch (error) {
            console.error("Error in RAG classification with segments:", error);
            // Fallback to regular classification
            try {
                const scores = await this.classify(transcript);
                return {
                    scores,
                    segments: []
                };
            } catch (fallbackError) {
                return {
                    scores: {
                        scienceTalk: 0,
                        socialTalk: 0,
                        literatureTalk: 0,
                        languageDevelopment: 0
                    },
                    segments: []
                };
            }
        }
    }

    /**
     * Build prompt that asks for segment identification
     * @param {string} transcript - Original transcript
     * @param {Object} similarExamples - Similar examples by category
     * @returns {string} Formatted prompt
     */
    _buildSegmentPrompt(transcript, similarExamples) {
        let prompt = `You are an expert in analyzing early childhood language development transcripts. Your task is to:
1. Classify the transcript into four categories with scores (0-100)
2. Identify specific segments (phrases or sentences) that contribute to each category

Categories:
1. Science Talk: Discussions about scientific concepts, observations, experiments, and natural phenomena
2. Social Talk: Communication about feelings, relationships, social interactions, sharing, and helping
3. Literature Talk: Storytelling, narrative language, imaginative play, and references to books/stories
4. Language Development: Discussions about words, communication, vocabulary, grammar, reading, and writing

Here are example transcripts for each category:

`;

        const categories = [
            { key: 'science', name: 'Science Talk' },
            { key: 'social', name: 'Social Talk' },
            { key: 'literature', name: 'Literature Talk' },
            { key: 'language', name: 'Language Development' }
        ];

        for (const { key, name } of categories) {
            const examples = similarExamples[key] || [];
            if (examples.length > 0) {
                prompt += `${name} Examples:\n`;
                examples.slice(0, 3).forEach((ex, idx) => {
                    prompt += `${idx + 1}. "${ex.text}"\n`;
                });
                prompt += `\n`;
            }
        }

        prompt += `Now analyze this transcript and provide:
1. Overall scores for each category (0-100)
2. Specific segments from the transcript that belong to each category

Transcript:
"${transcript}"

Provide your response as JSON with this exact format:
{
  "scores": {
    "scienceTalk": <number 0-100>,
    "socialTalk": <number 0-100>,
    "literatureTalk": <number 0-100>,
    "languageDevelopment": <number 0-100>
  },
  "segments": [
    {
      "text": "<exact phrase from transcript>",
      "category": "science|social|literature|language",
      "startIndex": <character position where segment starts>,
      "endIndex": <character position where segment ends>
    }
  ]
}

Only respond with the JSON object, no additional text.`;

        return prompt;
    }

    /**
     * Classify with segment identification using LLM
     * @param {string} prompt - Full RAG prompt
     * @param {string} transcript - Original transcript
     * @returns {Promise<Object>} Object with scores and segments
     */
    async _classifyWithSegmentsLLM(prompt, transcript) {
        try {
            const response = await this.openai.chat.completions.create({
                model: this.classificationModel,
                messages: [
                    {
                        role: "system",
                        content: "You are an expert in early childhood language development analysis. Always respond with valid JSON only. Identify exact text segments from the transcript."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.3,
                max_tokens: 2000
            });

            const content = response.choices[0]?.message?.content?.trim();
            
            if (!content) {
                throw new Error("Empty response from LLM");
            }

            // Extract JSON
            let jsonStr = content;
            const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
            if (jsonMatch) {
                jsonStr = jsonMatch[1];
            } else {
                const jsonObjectMatch = content.match(/\{[\s\S]*\}/);
                if (jsonObjectMatch) {
                    jsonStr = jsonObjectMatch[0];
                }
            }

            const result = JSON.parse(jsonStr);

            // Validate and normalize scores
            const scores = {
                scienceTalk: this._normalizeScore(result.scores?.scienceTalk || 0),
                socialTalk: this._normalizeScore(result.scores?.socialTalk || 0),
                literatureTalk: this._normalizeScore(result.scores?.literatureTalk || 0),
                languageDevelopment: this._normalizeScore(result.scores?.languageDevelopment || 0)
            };

            // Validate segments and find actual positions in transcript
            const segments = (result.segments || []).map(seg => {
                // Find actual position of segment text in transcript
                const text = seg.text || '';
                const startIndex = transcript.indexOf(text);
                const endIndex = startIndex >= 0 ? startIndex + text.length : -1;

                return {
                    text: text,
                    category: seg.category || 'unknown',
                    startIndex: startIndex >= 0 ? startIndex : (seg.startIndex || 0),
                    endIndex: endIndex >= 0 ? endIndex : (seg.endIndex || text.length)
                };
            }).filter(seg => seg.startIndex >= 0 && seg.endIndex > seg.startIndex && seg.category !== 'unknown');

            return { scores, segments };
        } catch (error) {
            console.error("Error in LLM classification with segments:", error);
            throw error;
        }
    }

    /**
     * Normalize score to 0-100 range
     * @param {number} score - Raw score
     * @returns {number} Normalized score (0-100)
     */
    _normalizeScore(score) {
        if (typeof score !== 'number' || isNaN(score)) {
            return 0;
        }
        // Clamp to 0-100 range
        return Math.max(0, Math.min(100, Math.round(score)));
    }
}

// Export singleton instance
const ragClassifier = new RAGClassifier();
export default ragClassifier;
