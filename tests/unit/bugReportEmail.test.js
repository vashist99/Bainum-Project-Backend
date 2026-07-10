import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildBugReportEmailPayload, escapeHtml } from "../../lib/bugReportEmail.js";

const REPORTER = { name: "Pat Parent", role: "parent", email: "pat@example.com" };

function baseReport(overrides = {}) {
    return {
        title: "Charts do not load",
        description: "The dot matrix stays blank on my child's page.",
        reporter: REPORTER,
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
        submittedAt: new Date("2026-07-10T12:00:00.000Z"),
        ...overrides,
    };
}

describe("bugReportEmail — escapeHtml", () => {
    test("escapes all five HTML-significant characters", () => {
        assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
    });

    test("handles null/undefined safely", () => {
        assert.equal(escapeHtml(null), "");
        assert.equal(escapeHtml(undefined), "");
    });
});

describe("bugReportEmail — buildBugReportEmailPayload", () => {
    test("subject follows the [Bug Report] format", () => {
        const { subject } = buildBugReportEmailPayload(baseReport());
        assert.equal(subject, "[Bug Report] Charts do not load — Bainum Dashboard");
    });

    test("script tags in user input are neutralized in the HTML body", () => {
        const { htmlContent } = buildBugReportEmailPayload(
            baseReport({ description: `<script>alert(1)</script>` })
        );
        assert.ok(htmlContent.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
        assert.ok(!htmlContent.includes("<script>alert(1)</script>"));
    });

    test("both variants carry the banner, reporter identity, and context", () => {
        const { htmlContent, textContent } = buildBugReportEmailPayload(
            baseReport({ pageOrFeature: "Child data page" })
        );
        for (const body of [htmlContent, textContent]) {
            assert.match(body, /submitted by a signed-in user of the Bainum dashboard/);
            assert.match(body, /Pat Parent \(parent, pat@example\.com\)/);
            assert.match(body, /Child data page/);
            assert.match(body, /Mozilla\/5\.0 \(X11; Linux x86_64\)/);
            assert.match(body, /2026-07-10T12:00:00\.000Z/);
        }
    });

    test("optional sections are omitted when absent", () => {
        const { htmlContent, textContent } = buildBugReportEmailPayload(baseReport());
        for (const body of [htmlContent, textContent]) {
            assert.ok(!body.includes("Steps to reproduce"));
            assert.ok(!body.includes("Where it happened"));
        }
    });

    test("optional sections render when provided", () => {
        const { htmlContent, textContent } = buildBugReportEmailPayload(
            baseReport({
                stepsToReproduce: "1. Open the page\n2. Wait",
                pageOrFeature: "Recording upload",
            })
        );
        for (const body of [htmlContent, textContent]) {
            assert.match(body, /Steps to reproduce/);
            assert.match(body, /1\. Open the page/);
            assert.match(body, /Where it happened/);
            assert.match(body, /Recording upload/);
        }
    });

    test("missing reporter fields degrade gracefully", () => {
        const { textContent } = buildBugReportEmailPayload(baseReport({ reporter: {} }));
        assert.match(textContent, /Unknown user \(unknown role, no email on file\)/);
    });
});
