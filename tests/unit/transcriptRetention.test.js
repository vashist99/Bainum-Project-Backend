import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    TRANSCRIPT_RETENTION_DAYS,
    transcriptExpiryFrom,
} from "../../lib/transcriptRetention.js";

describe("transcriptRetention", () => {
    test("retention window is 365 days", () => {
        assert.equal(TRANSCRIPT_RETENTION_DAYS, 365);
    });

    test("typical date: a mid-year recording lands exactly 365 days later", () => {
        const recordedAt = new Date("2026-06-15T10:30:00.000Z");
        const expiry = transcriptExpiryFrom(recordedAt);
        const diffMs = expiry.getTime() - recordedAt.getTime();
        const diffDays = diffMs / (24 * 60 * 60 * 1000);
        assert.equal(diffDays, 365);
    });

    test("Feb 29 rolls onto Feb 28 of the next year (not invalid)", () => {
        const leapDay = new Date("2024-02-29T12:00:00.000Z");
        const expiry = transcriptExpiryFrom(leapDay);
        assert.ok(!Number.isNaN(expiry.getTime()), "expiry must be a valid date");
        assert.equal(expiry.getUTCFullYear(), 2025);
        // setDate(d.getDate() + 365) on Feb 29 in a leap year lands on Feb 28
        // of the next year (which is non-leap).
        assert.equal(expiry.getUTCMonth(), 1);
        assert.equal(expiry.getUTCDate(), 28);
    });

    test("accepts a number (epoch ms)", () => {
        const recordedAt = new Date("2026-01-01T00:00:00.000Z");
        const expiry = transcriptExpiryFrom(recordedAt.getTime());
        assert.equal(
            expiry.getTime(),
            recordedAt.getTime() + 365 * 24 * 60 * 60 * 1000
        );
    });

    test("accepts an ISO string", () => {
        const expiry = transcriptExpiryFrom("2026-01-01T00:00:00.000Z");
        assert.equal(expiry.getUTCFullYear(), 2027);
        assert.equal(expiry.getUTCMonth(), 0);
        assert.equal(expiry.getUTCDate(), 1);
    });

    test("does not mutate the input Date", () => {
        const recordedAt = new Date("2026-06-15T10:30:00.000Z");
        const before = recordedAt.getTime();
        transcriptExpiryFrom(recordedAt);
        assert.equal(recordedAt.getTime(), before);
    });

    test("throws on invalid input", () => {
        assert.throws(() => transcriptExpiryFrom("not-a-date"), /invalid date/);
        assert.throws(() => transcriptExpiryFrom(NaN), /invalid date/);
    });
});
