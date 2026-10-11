/**
 * Speech-to-text through the University of Florida NaviGator Toolkit.
 * Whisper Large v3 runs on HiPerGator and is called with the OpenAI-compatible
 * audio transcriptions endpoint. Audio is not sent to Rev.ai.
 */

import "../config/loadEnv.js";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";

const DEFAULT_BASE_URL = "https://api.ai.it.ufl.edu/v1";
const DEFAULT_MODEL = "whisper-large-v3";

export function extractTranscriptText(result) {
    if (typeof result === "string") return result;
    if (typeof result?.text === "string" && result.text.trim()) return result.text;
    if (Array.isArray(result?.segments)) {
        return result.segments.map((segment) => segment?.text || "").join(" ").trim();
    }
    return result?.transcript || result?.transcription || "";
}

export function extractDurationSeconds(result) {
    if (!result || typeof result === "string") return null;
    const candidates = [result.duration, result.duration_seconds, result.durationSeconds];
    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return value;
    }
    if (Array.isArray(result.segments) && result.segments.length > 0) {
        const end = Math.max(...result.segments.map((segment) => Number(segment?.end) || 0));
        if (Number.isFinite(end) && end > 0) return end;
    }
    return null;
}

/** Duration of a PCM WAV file, used when the transcription response omits it. */
export function wavDurationSeconds(filePath) {
    let fd;
    try {
        fd = fs.openSync(filePath, "r");
        const header = Buffer.alloc(12);
        if (fs.readSync(fd, header, 0, 12, 0) < 12) return null;
        if (header.toString("ascii", 0, 4) !== "RIFF") return null;
        if (header.toString("ascii", 8, 12) !== "WAVE") return null;

        let offset = 12;
        let sampleRate = 0;
        let channels = 0;
        let bitsPerSample = 0;
        let dataSize = 0;
        const chunkHeader = Buffer.alloc(8);

        while (offset + 8 < 1024 * 1024) {
            if (fs.readSync(fd, chunkHeader, 0, 8, offset) < 8) break;
            const id = chunkHeader.toString("ascii", 0, 4);
            const size = chunkHeader.readUInt32LE(4);
            if (id === "fmt " && size >= 16) {
                const fmt = Buffer.alloc(16);
                fs.readSync(fd, fmt, 0, 16, offset + 8);
                channels = fmt.readUInt16LE(2);
                sampleRate = fmt.readUInt32LE(4);
                bitsPerSample = fmt.readUInt16LE(14);
            } else if (id === "data") {
                dataSize = size;
                break;
            }
            offset += 8 + size + (size % 2);
        }

        const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
        if (!bytesPerSecond || !dataSize) return null;
        return dataSize / bytesPerSecond;
    } catch {
        return null;
    } finally {
        if (fd != null) {
            try { fs.closeSync(fd); } catch { /* ignore */ }
        }
    }
}

function isCancelled(error, signal) {
    return Boolean(
        signal?.aborted ||
        error?.code === "ERR_CANCELED" ||
        error?.name === "CanceledError" ||
        error?.message?.toLowerCase?.().includes("canceled") ||
        error?.message?.toLowerCase?.().includes("cancelled")
    );
}

function isUnsupportedFormatError(error) {
    const status = error?.response?.status;
    if (status !== 400 && status !== 422) return false;
    const detail = JSON.stringify(error.response?.data || error.message || "").toLowerCase();
    return detail.includes("response_format") || detail.includes("verbose");
}

function mapNavigatorError(error) {
    if (error?.navigatorMapped) return error;
    if (isCancelled(error)) {
        const mapped = new Error("Processing cancelled by client");
        mapped.navigatorMapped = true;
        return mapped;
    }
    if (error?.code === "ECONNABORTED" || /timed out|timeout/i.test(error?.message || "")) {
        const mapped = new Error("NaviGator transcription timed out");
        mapped.navigatorMapped = true;
        return mapped;
    }
    if (!error?.response && (error?.code === "ECONNREFUSED" || error?.code === "ENOTFOUND" || error?.request)) {
        const mapped = new Error("NaviGator service is unreachable");
        mapped.navigatorMapped = true;
        return mapped;
    }
    const status = error?.response?.status;
    const apiMessage = error?.response?.data?.error?.message
        || error?.response?.data?.message
        || error?.message
        || "Unknown transcription error";
    const prefix = status === 401 || status === 403
        ? "NaviGator API key was rejected"
        : "NaviGator API error";
    const mapped = new Error(`${prefix}: ${apiMessage}`);
    mapped.navigatorMapped = true;
    return mapped;
}

class NavigatorWhisper {
    constructor(options = {}) {
        this.apiKey = options.apiKey ?? process.env.NAVIGATOR_API_KEY ?? "";
        this.apiBaseUrl = (options.apiBaseUrl || process.env.NAVIGATOR_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
        this.model = options.model || process.env.NAVIGATOR_WHISPER_MODEL || DEFAULT_MODEL;
        this.timeout = options.timeout || 300000;
        this.request = options.request || null;

        if (!this.apiKey) {
            console.warn("NaviGator API key not set. Set NAVIGATOR_API_KEY environment variable.");
        }
    }

    async transcribeFromFile(filePath, options = {}) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Audio file not found: ${filePath}`);
        }
        if (!this.apiKey) {
            throw new Error("NaviGator API key is required. Set NAVIGATOR_API_KEY environment variable.");
        }

        try {
            let payload;
            try {
                payload = await this._submit(filePath, options, "verbose_json");
            } catch (error) {
                if (isCancelled(error, options.signal) || !isUnsupportedFormatError(error)) {
                    throw error;
                }
                payload = await this._submit(filePath, options, "json");
            }

            const text = extractTranscriptText(payload);
            let durationSeconds = extractDurationSeconds(payload);
            if (durationSeconds == null) {
                durationSeconds = wavDurationSeconds(filePath);
            }

            return {
                text,
                durationSeconds,
                raw: payload,
            };
        } catch (error) {
            throw mapNavigatorError(error);
        }
    }

    async _submit(filePath, options, responseFormat) {
        if (this.request) {
            const response = await this.request({
                filePath,
                options,
                responseFormat,
                model: this.model,
            });
            return response?.data ?? response;
        }

        const filename = options.filename || path.basename(filePath) || "audio.wav";
        const mimetype = options.mimetype || "audio/wav";
        const formData = new FormData();
        formData.append("file", fs.createReadStream(filePath), {
            filename,
            contentType: mimetype,
        });
        formData.append("model", this.model);
        if (options.language) {
            formData.append("language", options.language);
        }
        formData.append("response_format", responseFormat);

        const response = await axios.post(`${this.apiBaseUrl}/audio/transcriptions`, formData, {
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                ...formData.getHeaders(),
            },
            timeout: this.timeout,
            signal: options.signal,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        });
        return response.data;
    }

    getTranscript(result) {
        return extractTranscriptText(result);
    }

    getConfig() {
        return {
            apiBaseUrl: this.apiBaseUrl,
            model: this.model,
            timeout: this.timeout,
            apiKeySet: !!this.apiKey,
        };
    }

    async isHealthy() {
        if (!this.apiKey) return false;
        try {
            const response = await axios.get(`${this.apiBaseUrl}/models`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                timeout: 10000,
            });
            const ids = (response.data?.data || []).map((model) => model?.id).filter(Boolean);
            if (ids.length === 0) return response.status === 200;
            return ids.some((id) => id === this.model || id.includes("whisper"));
        } catch (error) {
            console.warn("NaviGator health check failed:", error.message);
            return false;
        }
    }
}

const stt = new NavigatorWhisper();

export { NavigatorWhisper };
export default stt;
