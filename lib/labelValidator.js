import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

/**
 * Shared plumbing for LLM-vetted recording labels (activities, locations).
 * Each label kind supplies its own catalogs and system prompt; this module
 * owns the OpenAI client, the strict-JSON call, and the parse/error fallbacks
 * so the two validators can't drift apart.
 */

/** Case-insensitive, whitespace/punctuation-tolerant key for predefined matches. */
export function normalizeLabelKey(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

let openaiClient = null;
function getOpenAI() {
    if (openaiClient) return openaiClient;
    if (!process.env.OPENAI_API_KEY) return null;
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return openaiClient;
}

/**
 * Run a label through the LLM with a strict-JSON contract.
 *
 * @param {Object} options
 * @param {string} options.value Trimmed label text to vet
 * @param {string} options.systemPrompt Full system prompt for this label kind
 * @param {string} options.userPrompt Full user prompt for this label kind
 * @param {string} options.unavailableMessage Returned reason when the LLM is not configured
 * @param {string} options.defaultAcceptedReason Fallback reason when the LLM accepts without one
 * @param {string} options.defaultRejectedReason Fallback reason when the LLM rejects without one
 * @param {string} [options.logTag="labelValidator"] Prefix for error logs
 * @returns {Promise<{accepted: boolean, reason: string, normalized?: string}>}
 */
export async function validateLabelWithLLM({
    value,
    systemPrompt,
    userPrompt,
    unavailableMessage,
    defaultAcceptedReason,
    defaultRejectedReason,
    logTag = "labelValidator",
}) {
    const openai = getOpenAI();
    if (!openai) {
        return { accepted: false, reason: unavailableMessage };
    }

    const model = process.env.OPENAI_CLASSIFICATION_MODEL || "gpt-4o-mini";

    try {
        const response = await openai.chat.completions.create({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ],
            temperature: 0,
            max_tokens: 200,
            response_format: { type: "json_object" },
        });

        const content = response.choices?.[0]?.message?.content?.trim();
        if (!content) {
            return { accepted: false, reason: "Validation service returned an empty response. Please try again." };
        }

        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch {
            const match = content.match(/\{[\s\S]*\}/);
            parsed = match ? JSON.parse(match[0]) : null;
        }

        if (!parsed || typeof parsed.accepted !== "boolean") {
            return {
                accepted: false,
                reason: "Couldn't parse the validation response. Please try again or pick a predefined option.",
            };
        }

        const reason =
            typeof parsed.reason === "string" && parsed.reason.trim().length > 0
                ? parsed.reason.trim()
                : parsed.accepted
                    ? defaultAcceptedReason
                    : defaultRejectedReason;

        const normalized =
            typeof parsed.normalized === "string" && parsed.normalized.trim().length > 0
                ? parsed.normalized.trim()
                : value;

        return { accepted: !!parsed.accepted, reason, normalized };
    } catch (error) {
        console.error(`[${logTag}] OpenAI error:`, error.message);
        return {
            accepted: false,
            reason: "Couldn't reach the validation service. Please try again in a moment.",
        };
    }
}
