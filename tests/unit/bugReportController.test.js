import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
    submitBugReport,
    throttleCheck,
    resetBugReportThrottle,
    setBugReportEmailSenderForTests,
    THROTTLE_MAX_REPORTS,
    THROTTLE_WINDOW_MS,
} from "../../controllers/bugReportController.js";

const REPORTER = { id: "user-1", name: "Pat Parent", role: "parent", email: "pat@example.com" };

function makeRes() {
    const res = {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
    return res;
}

function makeReq(bodyOverrides = {}, user = REPORTER) {
    return {
        user,
        body: {
            recipientEmail: "dev@example.com",
            title: "Charts do not load",
            description: "The dot matrix stays blank.",
            ...bodyOverrides,
        },
    };
}

describe("bugReportController — submitBugReport", () => {
    let sentCalls;

    beforeEach(() => {
        resetBugReportThrottle();
        sentCalls = [];
        setBugReportEmailSenderForTests(async (recipientEmail, payload) => {
            sentCalls.push({ recipientEmail, payload });
            return { success: true, messageId: "test-id" };
        });
    });

    afterEach(() => {
        setBugReportEmailSenderForTests();
    });

    test("sends the email and returns 200 naming the recipient", async () => {
        const res = makeRes();
        await submitBugReport(makeReq(), res);
        assert.equal(res.statusCode, 200);
        assert.match(res.body.message, /dev@example\.com/);
        assert.equal(sentCalls.length, 1);
        assert.equal(sentCalls[0].recipientEmail, "dev@example.com");
    });

    test("400 for an invalid email address", async () => {
        const res = makeRes();
        await submitBugReport(makeReq({ recipientEmail: "not-an-email" }), res);
        assert.equal(res.statusCode, 400);
        assert.equal(sentCalls.length, 0);
    });

    test("400 for multiple recipients in one field", async () => {
        for (const value of ["a@x.com,b@y.com", "a@x.com;b@y.com", "a@x.com b@y.com"]) {
            const res = makeRes();
            await submitBugReport(makeReq({ recipientEmail: value }), res);
            assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(value)}`);
        }
        assert.equal(sentCalls.length, 0);
    });

    test("400 when title or description is missing or too long", async () => {
        const cases = [
            { title: "" },
            { description: "   " },
            { title: "x".repeat(151) },
            { description: "x".repeat(5001) },
            { stepsToReproduce: "x".repeat(5001) },
            { pageOrFeature: "x".repeat(301) },
        ];
        for (const overrides of cases) {
            const res = makeRes();
            await submitBugReport(makeReq(overrides), res);
            assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(Object.keys(overrides))}`);
        }
        assert.equal(sentCalls.length, 0);
    });

    test("reporter identity comes from the JWT, not the request body", async () => {
        const res = makeRes();
        const req = makeReq({
            reporter: { name: "Spoofed", role: "admin", email: "spoof@example.com" },
        });
        await submitBugReport(req, res);
        assert.equal(res.statusCode, 200);
        const { textContent } = sentCalls[0].payload;
        assert.match(textContent, /Pat Parent \(parent, pat@example\.com\)/);
        assert.ok(!textContent.includes("Spoofed"));
    });

    test("throttle allows 3 reports then 429s the 4th without sending", async () => {
        for (let i = 0; i < THROTTLE_MAX_REPORTS; i++) {
            const res = makeRes();
            await submitBugReport(makeReq(), res);
            assert.equal(res.statusCode, 200);
        }
        const res = makeRes();
        await submitBugReport(makeReq(), res);
        assert.equal(res.statusCode, 429);
        assert.ok(res.body.retryAfter > 0);
        assert.equal(sentCalls.length, THROTTLE_MAX_REPORTS);
    });

    test("throttle is per-user", async () => {
        for (let i = 0; i < THROTTLE_MAX_REPORTS; i++) {
            await submitBugReport(makeReq(), makeRes());
        }
        const res = makeRes();
        await submitBugReport(makeReq({}, { ...REPORTER, id: "user-2" }), res);
        assert.equal(res.statusCode, 200);
    });

    test("provider failure returns 502 and does not crash", async () => {
        setBugReportEmailSenderForTests(async () => {
            throw new Error("provider down");
        });
        const res = makeRes();
        await submitBugReport(makeReq(), res);
        assert.equal(res.statusCode, 502);
        assert.match(res.body.message, /provider down/);
    });
});

describe("bugReportController — throttleCheck window expiry", () => {
    beforeEach(() => resetBugReportThrottle());

    test("attempts outside the window no longer count", () => {
        const start = 1_000_000;
        for (let i = 0; i < THROTTLE_MAX_REPORTS; i++) {
            assert.equal(throttleCheck("u", start + i).allowed, true);
        }
        assert.equal(throttleCheck("u", start + 1000).allowed, false);
        assert.equal(throttleCheck("u", start + THROTTLE_WINDOW_MS + 1).allowed, true);
    });
});
