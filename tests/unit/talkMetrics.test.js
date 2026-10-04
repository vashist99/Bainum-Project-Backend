import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
    activityBucket,
    alphabetVersusKnowledge,
    filterByDateRange,
    talkByActivity,
    weightedPerMinute,
} from "../../../mockup1/src/lib/talkMetrics.js";

describe("activity buckets", () => {
    test("garden time is science and sensory", () => {
        assert.equal(activityBucket("Garden time", "school"), "Science and sensory");
    });

    test("music time is other", () => {
        assert.equal(activityBucket("Music time", "school"), "Other");
    });

    test("screen time stays its own bucket", () => {
        assert.equal(
            activityBucket("Screen time (e.g., movie/show, iPad/tablet/phone, video games)", "home"),
            "Screen time"
        );
    });

    test("ride-ons is structured or other", () => {
        assert.equal(activityBucket("Ride-ons", "home"), "Structured / other");
    });
});

describe("talk metrics aggregation", () => {
    test("empty buckets stay hidden", () => {
        const rows = talkByActivity([
            { activity: "Circle time", activityContext: "school", durationSeconds: 60, wordCount: 10, languageFeatures: { uniqueWordCount: 4, whQuestionCount: 1, utteranceCount: 2, meanUtteranceLength: 5 } },
        ], "school");
        assert.deepEqual(rows.map((row) => row.bucket), ["Circle and group"]);
    });

    test("why/how rate weights a short clip against a long one", () => {
        const rate = weightedPerMinute([
            { durationSeconds: 120, languageFeatures: { whQuestionCount: 4 } },
            { durationSeconds: 600, languageFeatures: { whQuestionCount: 0 } },
        ], (row) => row.languageFeatures.whQuestionCount);
        assert.equal(Math.round(rate * 1000) / 1000, Math.round((4 / 12) * 1000) / 1000);
    });

    test("alphabet comparison waits for three instructional recordings", () => {
        const instructional = (activity) => ({ activity, activityContext: "school" });
        assert.equal(alphabetVersusKnowledge([
            instructional("Alphabet practice"),
            instructional("Science experiments"),
        ]), null);
        const shown = alphabetVersusKnowledge([
            instructional("Alphabet practice"),
            instructional("Science experiments"),
            instructional("Story time / read aloud"),
        ]);
        assert.equal(shown.instructional, 3);
        assert.equal(Math.round(shown.alphabetShare * 100), 33);
    });

    test("date range keeps recordings on the boundary dates", () => {
        const rows = filterByDateRange([
            { date: "2026-03-01" },
            { date: "2026-03-15" },
            { date: "2026-04-01" },
        ], "2026-03-01", "2026-03-31");
        assert.equal(rows.length, 2);
    });
});
