import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    PREDEFINED_ACTIVITY_GROUPS,
    isPredefinedActivity,
    validateCustomActivity,
} from "../../lib/activityValidator.js";

describe("activityValidator – predefined catalog", () => {
    test("exposes home and school contexts", () => {
        assert.ok(Array.isArray(PREDEFINED_ACTIVITY_GROUPS.home));
        assert.ok(Array.isArray(PREDEFINED_ACTIVITY_GROUPS.school));
        assert.ok(PREDEFINED_ACTIVITY_GROUPS.home.length > 0);
        assert.ok(PREDEFINED_ACTIVITY_GROUPS.school.length > 0);
    });

    test("each entry has a category name and a non-empty activities list", () => {
        for (const ctx of ["home", "school"]) {
            for (const group of PREDEFINED_ACTIVITY_GROUPS[ctx]) {
                assert.equal(typeof group.category, "string", `${ctx} group missing category`);
                assert.ok(group.category.length > 0, `${ctx} group has empty category`);
                assert.ok(Array.isArray(group.activities), `${ctx}/${group.category} activities not array`);
                assert.ok(
                    group.activities.length > 0,
                    `${ctx}/${group.category} has no activities`
                );
                for (const activity of group.activities) {
                    assert.equal(typeof activity, "string");
                    assert.ok(activity.trim().length > 0);
                }
            }
        }
    });

    test("activity names within a context are unique", () => {
        for (const ctx of ["home", "school"]) {
            const seen = new Set();
            for (const group of PREDEFINED_ACTIVITY_GROUPS[ctx]) {
                for (const activity of group.activities) {
                    const key = activity.toLowerCase().trim();
                    assert.ok(!seen.has(key), `Duplicate activity in ${ctx}: ${activity}`);
                    seen.add(key);
                }
            }
        }
    });
});

describe("activityValidator – isPredefinedActivity", () => {
    test("matches a parent activity in the home context", () => {
        assert.equal(isPredefinedActivity("Puzzles", "home"), true);
        assert.equal(isPredefinedActivity("Bath time", "home"), true);
        assert.equal(isPredefinedActivity("Reading together", "home"), true);
    });

    test("matches a teacher activity in the school context", () => {
        assert.equal(isPredefinedActivity("Circle time", "school"), true);
        assert.equal(isPredefinedActivity("Field trip", "school"), true);
        assert.equal(isPredefinedActivity("Story time / read aloud", "school"), true);
    });

    test("rejects a parent-only activity when checked against school context", () => {
        // Bath time is in the parent catalog, not the teacher catalog.
        assert.equal(isPredefinedActivity("Bath time", "school"), false);
        assert.equal(isPredefinedActivity("Bottle time", "school"), false);
    });

    test("rejects a teacher-only activity when checked against home context", () => {
        // Calendar time / Attendance / Speech therapy are school-only items.
        assert.equal(isPredefinedActivity("Calendar time", "home"), false);
        assert.equal(isPredefinedActivity("Speech therapy", "home"), false);
        assert.equal(isPredefinedActivity("Question of the day", "home"), false);
    });

    test("accepts cross-context activities that appear in both catalogs", () => {
        // "Circle time" appears in the parent "Structured activities" group AND in the
        // school "Circle time & group meetings" group.
        assert.equal(isPredefinedActivity("Circle time", "home"), true);
        assert.equal(isPredefinedActivity("Circle time", "school"), true);
    });

    test("normalizes case, whitespace, and punctuation", () => {
        assert.equal(isPredefinedActivity("bath  TIME", "home"), true);
        assert.equal(isPredefinedActivity("Bath-time", "home"), true);
        assert.equal(isPredefinedActivity("BATH TIME", "home"), true);
        assert.equal(isPredefinedActivity("circle-time!", "school"), true);
    });

    test("ignores unrelated text", () => {
        assert.equal(isPredefinedActivity("stock trading", "home"), false);
        assert.equal(isPredefinedActivity("drinking beer", "school"), false);
        assert.equal(isPredefinedActivity("", "home"), false);
        assert.equal(isPredefinedActivity("   ", "school"), false);
    });

    test("when no context is given, matches against either catalog", () => {
        assert.equal(isPredefinedActivity("Bath time"), true); // home-only entry
        assert.equal(isPredefinedActivity("Calendar time"), true); // school-only entry
        assert.equal(isPredefinedActivity("Stock trading"), false);
    });
});

describe("activityValidator – validateCustomActivity (no LLM short-circuits)", () => {
    test("rejects empty input", async () => {
        const result = await validateCustomActivity("", "home");
        assert.equal(result.accepted, false);
        assert.match(result.reason, /enter an activity/i);
    });

    test("rejects input over 120 chars", async () => {
        const long = "a".repeat(121);
        const result = await validateCustomActivity(long, "home");
        assert.equal(result.accepted, false);
        assert.match(result.reason, /120 characters/i);
    });

    test("rejects invalid context", async () => {
        const result = await validateCustomActivity("Bath time", "office");
        assert.equal(result.accepted, false);
        assert.match(result.reason, /invalid context/i);
    });

    test("accepts a predefined activity without calling the LLM", async () => {
        // No OPENAI_API_KEY is needed because the predefined check short-circuits.
        const original = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        try {
            const result = await validateCustomActivity("Bath time", "home");
            assert.equal(result.accepted, true);
            assert.match(result.reason, /predefined/i);
            assert.equal(typeof result.normalized, "string");
        } finally {
            if (original !== undefined) process.env.OPENAI_API_KEY = original;
        }
    });

    test("rejects with a helpful message when LLM is needed but not configured", async () => {
        const original = process.env.OPENAI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        try {
            const result = await validateCustomActivity("brain surgery", "home");
            assert.equal(result.accepted, false);
            assert.match(result.reason, /can't be validated|not configured|predefined/i);
        } finally {
            if (original !== undefined) process.env.OPENAI_API_KEY = original;
        }
    });
});
