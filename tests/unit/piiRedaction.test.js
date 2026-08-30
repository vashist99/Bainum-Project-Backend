import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

process.env.PII_PERSON_RECOGNIZER = "compromise";

import { redactPii, redactTranscriptPayload } from "../../lib/piiRedaction.js";
import {
    __setPersonSpanFinderForTests,
    __resetPersonSpanFinderForTests,
} from "../../lib/pii/personRecognizer.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("redactPii", () => {
    after(() => {
        __resetPersonSpanFinderForTests();
    });

    test("empty input is a no-op", async () => {
        assert.deepEqual(await redactPii(""), { text: "", counts: {} });
        assert.deepEqual(await redactPii(null), { text: "", counts: {} });
    });

    test("replaces person names including first+last as one PERSON placeholder", async () => {
        const { text, counts } = await redactPii("Maya Lopez built a tower");
        assert.equal(text.includes("Maya"), false);
        assert.equal(text.includes("Lopez"), false);
        assert.match(text, /\[PERSON\]/);
        assert.equal((text.match(/\[PERSON\]/g) || []).length, 1);
        assert.ok(counts.PERSON >= 1);
    });

    test("replaces mixed contact and ID entities", async () => {
        const raw =
            "Email parent@school.edu or call 555-123-4567. SSN 123-45-6789.";
        const { text, counts } = await redactPii(raw);
        assert.equal(text.includes("parent@school.edu"), false);
        assert.equal(text.includes("555-123-4567"), false);
        assert.equal(text.includes("123-45-6789"), false);
        assert.match(text, /\[EMAIL\]/);
        assert.match(text, /\[PHONE\]/);
        assert.match(text, /\[SSN\]/);
        assert.ok(counts.EMAIL >= 1);
        assert.ok(counts.PHONE >= 1);
        assert.ok(counts.SSN >= 1);
        assert.equal(typeof counts.EMAIL, "number");
        assert.equal(Object.keys(counts).every((k) => typeof counts[k] === "number"), true);
    });

    test("is idempotent on already-redacted text", async () => {
        const once = await redactPii("Ask Maya Lopez at parent@school.edu");
        const twice = await redactPii(once.text);
        assert.equal(twice.text, once.text);
    });

    test("redactTranscriptPayload redacts transcript and ragSegments text", async () => {
        const out = await redactTranscriptPayload({
            transcript: "Maya said email me at parent@school.edu",
            ragSegments: [
                {
                    text: "email me at parent@school.edu",
                    category: "social",
                    startIndex: 10,
                    endIndex: 39,
                },
            ],
        });
        assert.equal(out.transcript.includes("parent@school.edu"), false);
        assert.match(out.transcript, /\[EMAIL\]/);
        assert.equal(out.ragSegments[0].text.includes("parent@school.edu"), false);
        assert.match(out.ragSegments[0].text, /\[EMAIL\]/);
        assert.equal(out.ragSegments[0].category, "social");
        assert.equal(typeof out.counts, "object");
    });

    test("thrown recognizer errors fall back to compromise and do not return the original string", async () => {
        __setPersonSpanFinderForTests(async () => {
            throw new Error("ner exploded with secret Maya Lopez");
        });
        const raw = "Maya Lopez lives here";
        const { text } = await redactPii(raw);
        assert.equal(text.includes("Maya"), false);
        assert.equal(text.includes("Lopez"), false);
        assert.match(text, /\[PERSON\]/);
        __resetPersonSpanFinderForTests();
    });
});

describe("persist and generation hooks", () => {
    test("accept-shaped payload cannot keep a raw email", async () => {
        const posted = {
            transcript: "Please email jane.doe@center.edu after circle time",
            ragSegments: [{ text: "jane.doe@center.edu waved", category: "social" }],
        };
        const stored = await redactTranscriptPayload(posted);
        assert.equal(stored.transcript.includes("jane.doe@center.edu"), false);
        assert.match(stored.transcript, /\[EMAIL\]/);
        assert.equal(stored.ragSegments[0].text.includes("jane.doe@center.edu"), false);
    });

    test("STT controllers redact immediately after getTranscript and before analyzeTranscript", () => {
        const files = [
            "controllers/whisperController.js",
            "controllers/classroomWhisperController.js",
            "controllers/activityRecordingController.js",
        ];
        for (const rel of files) {
            const src = fs.readFileSync(path.join(backendRoot, rel), "utf8");
            assert.ok(
                src.includes("await redactPii(revai.getTranscript"),
                `${rel} redacts immediately around getTranscript`
            );
            const redactIdx = src.indexOf("await redactPii");
            const analyzeIdx = src.indexOf("analyzeTranscript(transcript");
            assert.ok(analyzeIdx >= 0, `${rel} calls analyzeTranscript`);
            assert.ok(
                redactIdx < analyzeIdx,
                `${rel} must redact before keyword analysis`
            );
        }
    });

    test("accept and ingest write paths re-redact before insert", () => {
        const whisperRoutes = fs.readFileSync(
            path.join(backendRoot, "routes/whisperRoutes.js"),
            "utf8"
        );
        const teacherAccept = fs.readFileSync(
            path.join(backendRoot, "controllers/teacherAcceptController.js"),
            "utf8"
        );
        const writePathHits =
            (whisperRoutes.match(/redactTranscriptPayload/g) || []).length +
            (teacherAccept.match(/redactTranscriptPayload/g) || []).length;
        assert.ok(
            writePathHits >= 4,
            `expected >= 4 redactTranscriptPayload calls on write paths, got ${writePathHits}`
        );
        assert.ok(teacherAccept.includes("redactTranscriptPayload"));
        const ingest = fs.readFileSync(
            path.join(backendRoot, "controllers/assessmentIngestController.js"),
            "utf8"
        );
        assert.ok(ingest.includes("redactTranscriptPayload"));
        assert.ok(ingest.includes("redacted.transcript"));
    });
});
