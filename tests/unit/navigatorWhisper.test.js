import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
    NavigatorWhisper,
    extractTranscriptText,
    extractDurationSeconds,
    wavDurationSeconds,
} from "../../lib/navigatorWhisper.js";

function writeToneWav(filePath, seconds = 1) {
    const sampleRate = 16000;
    const samples = sampleRate * seconds;
    const dataSize = samples * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);
    fs.writeFileSync(filePath, buffer);
}

describe("navigator transcript parsing", () => {
    test("reads text and duration from a verbose Whisper payload", () => {
        const payload = {
            text: "count the dots",
            duration: 4.2,
            segments: [{ text: "count the dots", end: 4.2 }],
        };
        assert.equal(extractTranscriptText(payload), "count the dots");
        assert.equal(extractDurationSeconds(payload), 4.2);
    });

    test("falls back to the last segment end when duration is missing", () => {
        const payload = {
            text: "hello",
            segments: [{ end: 1.5 }, { end: 3.25 }],
        };
        assert.equal(extractDurationSeconds(payload), 3.25);
    });

    test("measures a wav file when the payload has no duration", () => {
        const filePath = path.join(os.tmpdir(), `navigator-whisper-${Date.now()}.wav`);
        writeToneWav(filePath, 2);
        try {
            const measured = wavDurationSeconds(filePath);
            assert.ok(Math.abs(measured - 2) < 0.01);
        } finally {
            fs.unlinkSync(filePath);
        }
    });
});

describe("NavigatorWhisper client", () => {
    test("returns transcript text and duration from verbose_json", async () => {
        const filePath = path.join(os.tmpdir(), `navigator-whisper-req-${Date.now()}.wav`);
        writeToneWav(filePath, 1);
        const client = new NavigatorWhisper({
            apiKey: "test-key",
            request: async ({ responseFormat, model }) => {
                assert.equal(responseFormat, "verbose_json");
                assert.equal(model, "whisper-large-v3");
                return { data: { text: "the letter m", duration: 1 } };
            },
        });
        try {
            const result = await client.transcribeFromFile(filePath, { language: "en" });
            assert.equal(client.getTranscript(result), "the letter m");
            assert.equal(result.durationSeconds, 1);
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    test("retries with json when verbose_json is rejected, then uses wav duration", async () => {
        const filePath = path.join(os.tmpdir(), `navigator-whisper-retry-${Date.now()}.wav`);
        writeToneWav(filePath, 2);
        const formats = [];
        const client = new NavigatorWhisper({
            apiKey: "test-key",
            request: async ({ responseFormat }) => {
                formats.push(responseFormat);
                if (responseFormat === "verbose_json") {
                    const error = new Error("bad format");
                    error.response = { status: 400, data: { error: { message: "response_format verbose_json is not supported" } } };
                    throw error;
                }
                return { data: { text: "hello there" } };
            },
        });
        try {
            const result = await client.transcribeFromFile(filePath);
            assert.deepEqual(formats, ["verbose_json", "json"]);
            assert.equal(result.text, "hello there");
            assert.ok(Math.abs(result.durationSeconds - 2) < 0.01);
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    test("missing key fails before any request", async () => {
        const filePath = path.join(os.tmpdir(), `navigator-whisper-nokey-${Date.now()}.wav`);
        writeToneWav(filePath, 1);
        const client = new NavigatorWhisper({
            apiKey: "",
            request: async () => {
                throw new Error("should not be called");
            },
        });
        try {
            await assert.rejects(
                () => client.transcribeFromFile(filePath),
                /NAVIGATOR_API_KEY/
            );
        } finally {
            fs.unlinkSync(filePath);
        }
    });

    test("an aborted request is reported as a client cancel", async () => {
        const filePath = path.join(os.tmpdir(), `navigator-whisper-cancel-${Date.now()}.wav`);
        writeToneWav(filePath, 1);
        const client = new NavigatorWhisper({
            apiKey: "test-key",
            request: async () => {
                const error = new Error("canceled");
                error.code = "ERR_CANCELED";
                throw error;
            },
        });
        try {
            await assert.rejects(
                () => client.transcribeFromFile(filePath),
                /Processing cancelled by client/
            );
        } finally {
            fs.unlinkSync(filePath);
        }
    });
});
