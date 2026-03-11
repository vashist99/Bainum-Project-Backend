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
     * Classify transcript and return annotated segments only (no scores).
     * WPM is computed from segment word counts / duration in the controller.
     * @param {string} transcript - Transcript text to classify
     * @returns {Promise<Object>} Object with segments only
     */
    async classifyWithSegments(transcript) {
        if (!transcript || typeof transcript !== "string" || transcript.trim().length === 0) {
            return { segments: [] };
        }

        if (!this.openai) {
            throw new Error("OpenAI API key not configured");
        }

        try {
            const transcriptEmbedding = await embeddingService.generateEmbedding(transcript);
            const similarExamples = await vectorStore.findSimilarByCategory(transcriptEmbedding, this.topK);
            const prompt = this._buildSegmentPrompt(transcript, similarExamples);
            const result = await this._classifyWithSegmentsLLM(prompt, transcript);
            return result;
        } catch (error) {
            console.error("Error in RAG classification with segments:", error);
            return { segments: [] };
        }
    }

    /**
     * Build prompt that asks only for segment identification (no scores)
     */
    _buildSegmentPrompt(transcript, similarExamples) {
        let prompt = `You are an expert in analyzing early childhood language development transcripts. Your task is to identify specific segments (phrases or sentences) from the transcript that belong to each of four categories.

Categories:
1. Science Talk: Discussions about scientific concepts, observations, experiments, and natural phenomena
2. Social Talk: Communication about feelings, relationships, social interactions, sharing, and helping
3. Literature Talk: Storytelling, narrative language, imaginative play, and references to books/stories
4. Language Development: Discussions about words, communication, vocabulary, grammar, reading, and writing

Here are example transcripts for each category:

`;

        const categories = [
            { key: "science", name: "Science Talk" },
            { key: "social", name: "Social Talk" },
            { key: "literature", name: "Literature Talk" },
            { key: "language", name: "Language Development" }
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

        prompt += `Now identify specific segments from this transcript that belong to each category. Use EXACT text from the transcript.

Transcript:
"${transcript}"

Provide your response as JSON with this exact format:
{
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

    async _classifyWithSegmentsLLM(prompt, transcript) {
        const response = await this.openai.chat.completions.create({
            model: this.classificationModel,
            messages: [
                {
                    role: "system",
                    content: "You are an expert in early childhood language development analysis. Always respond with valid JSON only. Identify exact text segments from the transcript."
                },
                { role: "user", content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 2000
        });

        const content = response.choices[0]?.message?.content?.trim();
        if (!content) throw new Error("Empty response from LLM");

        let jsonStr = content;
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) jsonStr = jsonMatch[1];
        else {
            const objMatch = content.match(/\{[\s\S]*\}/);
            if (objMatch) jsonStr = objMatch[0];
        }

        const result = JSON.parse(jsonStr);
        const segments = (result.segments || [])
            .map((seg) => {
                const text = seg.text || "";
                const startIndex = transcript.indexOf(text);
                const endIndex = startIndex >= 0 ? startIndex + text.length : -1;
                return {
                    text,
                    category: seg.category || "unknown",
                    startIndex: startIndex >= 0 ? startIndex : seg.startIndex || 0,
                    endIndex: endIndex >= 0 ? endIndex : seg.endIndex || text.length
                };
            })
            .filter((seg) => seg.startIndex >= 0 && seg.endIndex > seg.startIndex && seg.category !== "unknown");

        return { segments };
    }
}

const ragClassifier = new RAGClassifier();
export default ragClassifier;
