/**
 * Transcript PII redaction. Runs locally; never logs matched strings.
 */

import { findPatternSpans } from "./pii/patternRecognizers.js";
import { findPersonSpans } from "./pii/personRecognizer.js";

const PRIORITY = Object.freeze({
    SSN: 100,
    CREDIT_CARD: 90,
    EMAIL: 80,
    PHONE: 70,
    ADDRESS: 60,
    DATE_OF_BIRTH: 50,
    PERSON: 10,
});

const PLACEHOLDER_RE = /\[[A-Z_]+\]/g;

function existingPlaceholderSpans(text) {
    const spans = [];
    const re = new RegExp(PLACEHOLDER_RE.source, "g");
    let match;
    while ((match = re.exec(text)) !== null) {
        spans.push({ start: match.index, end: match.index + match[0].length });
    }
    return spans;
}

function overlaps(a, b) {
    return !(a.end <= b.start || a.start >= b.end);
}

function selectNonOverlapping(spans) {
    const sorted = [...spans].sort((a, b) => {
        const pd = (PRIORITY[b.type] || 0) - (PRIORITY[a.type] || 0);
        if (pd !== 0) return pd;
        return (b.end - b.start) - (a.end - a.start);
    });
    const kept = [];
    for (const span of sorted) {
        if (kept.some((k) => overlaps(k, span))) continue;
        kept.push(span);
    }
    return kept.sort((a, b) => a.start - b.start);
}

function collapseAdjacentSameType(spans, text) {
    if (spans.length === 0) return [];
    const out = [{ ...spans[0] }];
    for (let i = 1; i < spans.length; i += 1) {
        const prev = out[out.length - 1];
        const cur = spans[i];
        const between = text.slice(prev.end, cur.start);
        if (prev.type === cur.type && /^\s*$/.test(between)) {
            prev.end = cur.end;
        } else {
            out.push({ ...cur });
        }
    }
    return out;
}

function applySpans(text, spans) {
    let result = text;
    for (let i = spans.length - 1; i >= 0; i -= 1) {
        const span = spans[i];
        result = `${result.slice(0, span.start)}[${span.type}]${result.slice(span.end)}`;
    }
    return result;
}

function countByType(spans) {
    const counts = {};
    for (const span of spans) {
        counts[span.type] = (counts[span.type] || 0) + 1;
    }
    return counts;
}

function logCounts(counts) {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (total > 0) {
        console.log("[pii] redacted entity counts:", counts);
    }
}

/**
 * @param {unknown} text
 * @returns {Promise<{ text: string, counts: Record<string, number> }>}
 */
export async function redactPii(text) {
    if (text == null || text === "") {
        return { text: text == null ? "" : text, counts: {} };
    }
    if (typeof text !== "string") {
        return { text: "", counts: {} };
    }

    try {
        const placeholders = existingPlaceholderSpans(text);
        const rawSpans = [
            ...findPatternSpans(text),
            ...(await findPersonSpans(text)),
        ].filter((span) => !placeholders.some((p) => overlaps(p, span)));

        const selected = collapseAdjacentSameType(selectNonOverlapping(rawSpans), text);
        const redacted = applySpans(text, selected);
        const counts = countByType(selected);
        logCounts(counts);
        return { text: redacted, counts };
    } catch (err) {
        console.error("[pii] redaction failed:", err?.name || "Error");
        throw new Error("PII redaction failed");
    }
}

/**
 * @param {{ transcript?: string, ragSegments?: Array<{ text?: string }>|null }} payload
 * @returns {Promise<{ transcript: string, ragSegments: unknown, counts: Record<string, number> }>}
 */
export async function redactTranscriptPayload({ transcript, ragSegments } = {}) {
    const main = await redactPii(transcript || "");
    let segments = ragSegments;
    const combinedCounts = { ...main.counts };

    if (Array.isArray(ragSegments)) {
        segments = [];
        for (const seg of ragSegments) {
            if (!seg || typeof seg !== "object") {
                segments.push(seg);
                continue;
            }
            const redactedSeg = await redactPii(seg.text || "");
            for (const [type, n] of Object.entries(redactedSeg.counts)) {
                combinedCounts[type] = (combinedCounts[type] || 0) + n;
            }
            segments.push({ ...seg, text: redactedSeg.text });
        }
    }

    return {
        transcript: main.text,
        ragSegments: segments,
        counts: combinedCounts,
    };
}
