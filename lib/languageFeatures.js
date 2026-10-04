/**
 * Layer 1 counts from a redacted transcript.
 * Rates are not stored; callers divide counts by duration minutes.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { KEYWORDS } from "./transcriptProcessor.js";

export const LANGUAGE_FEATURES_SCHEMA_VERSION = 1;

const CATEGORIES = ["science", "social", "literature", "language"];
const STEMS = new Set(["who", "what", "where", "when", "why", "how", "which"]);
const FILLERS = new Set([
    "so", "and", "but", "well", "okay", "ok", "um", "uh", "oh",
    "please", "now", "then", "alright", "right",
]);
const CONJUNCTIONS = new Set([
    "and", "but", "or", "so", "because", "if", "when", "while", "that",
    "although", "unless", "until", "before", "after", "since", "which",
]);
const GENERIC_VERBS = new Set(["have", "has", "are", "is"]);
const INFLECTIONS = [
    ["ies", "y"],
    ["ied", "y"],
    ["ing", ""],
    ["ed", ""],
    ["es", ""],
    ["s", ""],
];

let commonWords = null;

function loadCommonWords() {
    if (commonWords) return commonWords;
    const here = path.dirname(fileURLToPath(import.meta.url));
    const raw = fs.readFileSync(path.join(here, "language", "common-words.txt"), "utf8");
    commonWords = new Set(
        raw.split(/\r?\n/).map((line) => line.trim().toLowerCase()).filter((line) => line && !line.startsWith("#"))
    );
    return commonWords;
}

export function tokenize(text) {
    if (!text || typeof text !== "string") return [];
    const tokens = [];
    for (const raw of text.split(/\s+/)) {
        if (!raw) continue;
        const lower = raw.toLowerCase();
        if (/^\[[^\]]*\]$/.test(lower)) continue;
        const token = lower.replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
        if (!token || /^\d+$/.test(token)) continue;
        tokens.push(token);
    }
    return tokens;
}

export function splitUtterances(text) {
    const raw = String(text ?? "").replace(/\r\n/g, "\n");
    if (!raw.trim()) return [];
    if (!/[.!?]/.test(raw)) {
        return raw.split(/\n+| {3,}/).map((part) => part.trim()).filter(Boolean);
    }
    const chunks = [];
    const re = /[^.\n!?]*[.\n!?]+|[^.\n!?]+$/g;
    let match;
    while ((match = re.exec(raw))) {
        const piece = match[0].trim();
        if (piece && !/^[.!?]+$/.test(piece)) chunks.push(piece);
    }
    return chunks;
}

function firstContentTokens(tokens) {
    const content = [];
    for (const token of tokens) {
        if (FILLERS.has(token)) continue;
        content.push(token);
    }
    return content;
}

function isWhyHowQuestion(utterance) {
    const content = firstContentTokens(tokenize(utterance));
    if (content.length === 0) return false;
    const [first, second] = content;
    const stem = STEMS.has(first) || (first === "how" && second === "come");
    if (!stem) return false;
    const startsWithStem = STEMS.has(first);
    return utterance.includes("?") || startsWithStem;
}

function isCommon(token, words) {
    if (words.has(token)) return true;
    for (const [suffix, replacement] of INFLECTIONS) {
        if (token.length <= suffix.length + 1) continue;
        if (!token.endsWith(suffix)) continue;
        const stem = token.slice(0, -suffix.length) + replacement;
        if (stem && words.has(stem)) return true;
    }
    return false;
}

function isPlural(token) {
    return token.endsWith("s") && !token.endsWith("ss") && token.length > 2;
}

function hasGenericPhrase(tokens) {
    for (let i = 0; i < tokens.length; i += 1) {
        if (isPlural(tokens[i])) {
            const window = tokens.slice(i + 1, i + 4);
            if (window.some((token) => GENERIC_VERBS.has(token))) return true;
        }
        if ((tokens[i] === "a" || tokens[i] === "an") && tokens[i + 2] && GENERIC_VERBS.has(tokens[i + 2])) {
            return true;
        }
    }
    return false;
}

function emptyCounts() {
    return {
        uniqueWordCount: 0,
        varietyRatio: null,
        utteranceCount: 0,
        meanUtteranceLength: null,
        conjunctionCount: 0,
        rareWordCount: 0,
        whQuestionCount: 0,
        genericPhraseCount: 0,
    };
}

function measure(text) {
    const tokens = tokenize(text);
    const utterances = splitUtterances(text);
    if (tokens.length === 0 && utterances.length === 0) return emptyCounts();
    const unique = new Set(tokens);
    const words = loadCommonWords();
    let conjunctionCount = 0;
    let rareWordCount = 0;
    for (const token of tokens) {
        if (CONJUNCTIONS.has(token)) conjunctionCount += 1;
        if (!isCommon(token, words)) rareWordCount += 1;
    }
    let whQuestionCount = 0;
    let genericPhraseCount = 0;
    for (const utterance of utterances) {
        if (isWhyHowQuestion(utterance)) whQuestionCount += 1;
        if (hasGenericPhrase(tokenize(utterance))) genericPhraseCount += 1;
    }
    const utteranceCount = utterances.length;
    return {
        uniqueWordCount: unique.size,
        varietyRatio: tokens.length === 0 ? null : unique.size / tokens.length,
        utteranceCount,
        meanUtteranceLength: utteranceCount === 0
            ? null
            : Math.round((tokens.length / utteranceCount) * 10) / 10,
        conjunctionCount,
        rareWordCount,
        whQuestionCount,
        genericPhraseCount,
    };
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreUtterance(utterance) {
    const scores = { science: 0, social: 0, literature: 0, language: 0 };
    const tokens = tokenize(utterance);
    const lower = utterance.toLowerCase();
    for (const category of CATEGORIES) {
        for (const keyword of KEYWORDS[category]) {
            if (keyword.includes(" ")) {
                const re = new RegExp(`\\b${escapeRegExp(keyword).replace(/\s+/g, "\\s+")}\\b`, "gi");
                const matches = lower.match(re);
                if (matches) scores[category] += matches.length;
                continue;
            }
            if (STEMS.has(keyword)) continue;
            const needle = keyword.toLowerCase();
            for (const token of tokens) {
                if (token === needle) scores[category] += 1;
            }
        }
    }
    return scores;
}

function winningCategory(scores) {
    let best = null;
    let bestScore = 0;
    let tied = false;
    for (const category of CATEGORIES) {
        const score = scores[category];
        if (score > bestScore) {
            best = category;
            bestScore = score;
            tied = false;
        } else if (score === bestScore && score > 0) {
            tied = true;
        }
    }
    if (!best || tied || bestScore === 0) return null;
    return best;
}

function categoryCounts(text) {
    const buckets = { science: [], social: [], literature: [], language: [] };
    for (const utterance of splitUtterances(text)) {
        const category = winningCategory(scoreUtterance(utterance));
        if (category) buckets[category].push(utterance);
    }
    const features = {};
    for (const category of CATEGORIES) {
        features[category] = buckets[category].length
            ? measure(buckets[category].join("\n"))
            : emptyCounts();
    }
    return features;
}

let computeOverride = null;

export function __setLanguageFeatureComputeForTests(fn) {
    computeOverride = fn ?? null;
}

export function languageFeaturesForTranscript(transcript) {
    if (!transcript || !String(transcript).trim()) {
        return { languageFeatures: null, categoryLanguageFeatures: null };
    }
    try {
        const compute = computeOverride || computeLanguageFeatures;
        return compute(transcript);
    } catch (error) {
        console.warn("[languageFeatures] computation failed", error);
        return { languageFeatures: null, categoryLanguageFeatures: null };
    }
}

/**
 * @param {string} redactedTranscript
 * @returns {{ languageFeatures: object, categoryLanguageFeatures: object }}
 */
export function computeLanguageFeatures(redactedTranscript) {
    const measured = measure(redactedTranscript || "");
    return {
        languageFeatures: {
            ...measured,
            computedAt: new Date(),
            schemaVersion: LANGUAGE_FEATURES_SCHEMA_VERSION,
        },
        categoryLanguageFeatures: categoryCounts(redactedTranscript || ""),
    };
}
