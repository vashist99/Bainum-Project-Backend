/**
 * PERSON span detector: Transformers.js CoNLL NER with a compromise fallback.
 * Unredacted text never leaves the process.
 */

import os from "os";
import path from "path";
import nlp from "compromise";

const CALENDAR_WORDS = new Set([
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]);

const DEFAULT_MODEL = "Xenova/bert-base-NER";
const NER_SCORE_MIN = 0.7;
const CHUNK_CHARS = 1200;

let pipelinePromise = null;
let testFinder = null;

/**
 * @param {((text: string) => Promise<Array<{start:number,end:number,type:string}>>)|null} fn
 */
export function __setPersonSpanFinderForTests(fn) {
    testFinder = fn;
}

export function __resetPersonSpanFinderForTests() {
    testFinder = null;
}

/**
 * PERSON recognizer selection.
 * Render web services OOM or hit the HTTP proxy timeout loading BERT ONNX
 * after STT; the 502 has no CORS headers, so the browser reports a CORS error.
 * Default to compromise there unless PII_PERSON_RECOGNIZER is set explicitly.
 */
export function resolvePersonRecognizerMode({
    explicit = process.env.PII_PERSON_RECOGNIZER,
    onRender = String(process.env.RENDER || "").toLowerCase() === "true",
} = {}) {
    const raw = String(explicit || "").toLowerCase().trim();
    if (raw === "compromise" || raw === "transformers") return raw;
    if (onRender) return "compromise";
    return "transformers";
}

function personMode() {
    return resolvePersonRecognizerMode();
}

function isCalendarToken(word) {
    return CALENDAR_WORDS.has(String(word || "").toLowerCase());
}

/**
 * compromise + capitalized multi-word names. Used as the production fallback
 * and as the default in unit tests (`PII_PERSON_RECOGNIZER=compromise`).
 * @param {string} text
 * @returns {Array<{ start: number, end: number, type: string }>}
 */
export function findPersonSpansCompromise(text) {
    if (!text || typeof text !== "string") return [];
    const spans = [];

    try {
        const peopleJson = nlp(text).people().json({ offset: true });
        for (const json of peopleJson) {
            const name = json?.text;
            if (!name || isCalendarToken(name)) continue;
            const offset = json?.offset;
            if (offset && typeof offset.start === "number" && typeof offset.length === "number") {
                spans.push({
                    start: offset.start,
                    end: offset.start + offset.length,
                    type: "PERSON",
                });
                continue;
            }
            let from = 0;
            let idx;
            while ((idx = text.indexOf(name, from)) !== -1) {
                spans.push({ start: idx, end: idx + name.length, type: "PERSON" });
                from = idx + name.length;
            }
        }
    } catch {
        // Fall through to the capitalized-sequence heuristic.
    }

    const multi = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
    let match;
    while ((match = multi.exec(text)) !== null) {
        const words = match[0].split(/\s+/);
        if (words.every(isCalendarToken)) continue;
        spans.push({
            start: match.index,
            end: match.index + match[0].length,
            type: "PERSON",
        });
    }

    return spans;
}

async function getNerPipeline() {
    if (pipelinePromise) return pipelinePromise;
    pipelinePromise = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        const cacheDir =
            process.env.TRANSFORMERS_CACHE ||
            process.env.HF_HOME ||
            path.join(os.tmpdir(), "cattac-transformers-cache");
        env.cacheDir = cacheDir;
        env.allowRemoteModels = true;
        const modelId = process.env.PII_NER_MODEL || DEFAULT_MODEL;
        return pipeline("token-classification", modelId, {
            aggregation_strategy: "simple",
            dtype: "fp32",
        });
    })();
    try {
        return await pipelinePromise;
    } catch (err) {
        pipelinePromise = null;
        throw err;
    }
}

function chunkText(text) {
    if (text.length <= CHUNK_CHARS) return [{ text, offset: 0 }];
    const chunks = [];
    let offset = 0;
    while (offset < text.length) {
        let end = Math.min(offset + CHUNK_CHARS, text.length);
        if (end < text.length) {
            const slice = text.slice(offset, end);
            const lastSpace = slice.lastIndexOf(" ");
            if (lastSpace > CHUNK_CHARS / 2) end = offset + lastSpace;
        }
        chunks.push({ text: text.slice(offset, end), offset });
        offset = end;
    }
    return chunks;
}

async function findPersonSpansTransformers(text) {
    const ner = await getNerPipeline();
    const spans = [];
    for (const chunk of chunkText(text)) {
        const output = await ner(chunk.text);
        const items = Array.isArray(output) ? output : [];
        for (const item of items) {
            const group = String(item.entity_group || item.entity || "").toUpperCase();
            if (group !== "PER" && group !== "PERSON" && !group.endsWith("PER")) continue;
            if (typeof item.score === "number" && item.score < NER_SCORE_MIN) continue;
            let start = typeof item.start === "number" ? item.start : -1;
            let end = typeof item.end === "number" ? item.end : -1;
            if (start < 0 || end <= start) {
                const word = item.word?.replace(/^##/, "").trim();
                if (!word) continue;
                const idx = chunk.text.indexOf(word);
                if (idx < 0) continue;
                start = idx;
                end = idx + word.length;
            }
            spans.push({
                start: chunk.offset + start,
                end: chunk.offset + end,
                type: "PERSON",
            });
        }
    }
    return spans;
}

/**
 * @param {string} text
 * @returns {Promise<Array<{ start: number, end: number, type: string }>>}
 */
export async function findPersonSpans(text) {
    if (testFinder) return testFinder(text);
    if (!text || typeof text !== "string") return [];

    if (personMode() === "compromise") {
        return findPersonSpansCompromise(text);
    }

    try {
        return await findPersonSpansTransformers(text);
    } catch {
        return findPersonSpansCompromise(text);
    }
}
