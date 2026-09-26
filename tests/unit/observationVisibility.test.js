import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    observationVisibleTo,
    canHideObservation,
    filterVisibleObservations,
    observationCommentUpdate,
    serializeObservationMeta,
    withObservationFields,
} from "../../lib/observationVisibility.js";
import { computeCohortStatsFromAssessments } from "../../lib/cohortStatsService.js";

const RECORDER = { id: "64b0000000000000000000aa", role: "teacher", name: "Riley" };
const ADMIN = { id: "64b0000000000000000000ad", role: "admin", name: "Ada" };
const OTHER = { id: "64b0000000000000000000bb", role: "teacher", name: "Other" };

const visibleDoc = {
    _id: "a1",
    hidden: false,
    recordedById: RECORDER.id,
    categoryWPM: { science: 10, social: 8, literature: 4, language: 20 },
    teacherId: RECORDER.id,
};

const hiddenDoc = {
    _id: "a2",
    hidden: true,
    recordedById: RECORDER.id,
    categoryWPM: { science: 50, social: 40, literature: 30, language: 60 },
    teacherId: RECORDER.id,
};

describe("observation comments — append only", () => {
    const firstAt = new Date("2026-03-01T15:00:00.000Z");
    const secondAt = new Date("2026-03-02T15:00:00.000Z");

    test("a later post pushes a new comment and leaves the earlier one", () => {
        const doc = { _id: "a1", observationComments: [] };
        const first = observationCommentUpdate(doc, RECORDER, "First look", firstAt);
        assert.equal(first.ok, true);
        assert.equal(first.update.$push.observationComments.text, "First look");
        assert.equal(first.update.$push.observationComments.authorName, "Riley");
        assert.equal(first.update.$push.observationComments.authorId, RECORDER.id);

        const withFirst = {
            _id: "a1",
            observationComments: [first.update.$push.observationComments],
        };
        const second = observationCommentUpdate(withFirst, ADMIN, "Agreed", secondAt);
        assert.equal(second.update.$push.observationComments.text, "Agreed");
        assert.equal(second.update.$push.observationComments.authorName, "Ada");
        assert.equal(withFirst.observationComments[0].text, "First look");
        assert.equal(withFirst.observationComments[0].authorId, RECORDER.id);
    });

    test("empty and over-long text are rejected", () => {
        const empty = observationCommentUpdate({ _id: "a1" }, OTHER, "   ");
        assert.equal(empty.ok, false);
        assert.match(empty.message, /empty/i);

        const tooLong = observationCommentUpdate({ _id: "a1" }, OTHER, "a".repeat(4001));
        assert.equal(tooLong.ok, false);
        assert.match(tooLong.message, /4000/);
    });

    test("a legacy note becomes the first comment and is cleared", () => {
        const doc = {
            _id: "a1",
            observationNote: {
                text: "Old note",
                authorName: "Riley",
                authorId: RECORDER.id,
                updatedAt: firstAt,
            },
        };
        const plan = observationCommentUpdate(doc, ADMIN, "Next", secondAt);
        const comments = plan.update.$set.observationComments;
        assert.equal(comments[0].text, "Old note");
        assert.equal(comments[0].authorName, "Riley");
        assert.equal(comments[0].createdAt, firstAt);
        assert.equal(comments[1].text, "Next");
        assert.equal(comments[1].authorId, ADMIN.id);
        assert.equal(plan.update.$set.observationNote.text, "");
        assert.equal(plan.update.$set.observationNote.authorId, null);
    });

    test("serialization returns comments oldest first and omits the note field", () => {
        const later = {
            text: "Later",
            authorName: "Ada",
            authorId: ADMIN.id,
            createdAt: secondAt,
        };
        const earlier = {
            text: "Earlier",
            authorName: "Riley",
            authorId: RECORDER.id,
            createdAt: firstAt,
        };
        const meta = serializeObservationMeta(RECORDER, {
            observationComments: [later, earlier],
            observationNote: { text: "Should not win", authorName: "Other" },
        });
        assert.deepEqual(
            meta.observationComments.map((comment) => comment.text),
            ["Earlier", "Later"]
        );
        assert.equal(Object.hasOwn(meta, "observationNote"), false);

        const [listed] = withObservationFields(RECORDER, [
            {
                observationNote: {
                    text: "Legacy only",
                    authorName: "Riley",
                    authorId: RECORDER.id,
                    updatedAt: firstAt,
                },
            },
        ]);
        assert.equal(listed.observationComments[0].text, "Legacy only");
        assert.equal(Object.hasOwn(listed, "observationNote"), false);
    });
});

describe("observation hide — recorder only", () => {
    test("recorder can hide; admin and other cannot", () => {
        assert.equal(canHideObservation(RECORDER, hiddenDoc), true);
        assert.equal(canHideObservation(ADMIN, hiddenDoc), false);
        assert.equal(canHideObservation(OTHER, visibleDoc), false);
    });

    test("legacy rows without recordedById cannot be hidden", () => {
        assert.equal(canHideObservation(RECORDER, { hidden: false }), false);
        assert.equal(serializeObservationMeta(RECORDER, { hidden: false }).canHide, false);
    });
});

describe("observation visibility", () => {
    test("hidden rows are omitted for admin and other; recorder still sees them", () => {
        const docs = [visibleDoc, hiddenDoc];
        assert.deepEqual(
            filterVisibleObservations(ADMIN, docs).map((d) => d._id),
            ["a1"]
        );
        assert.deepEqual(
            filterVisibleObservations(OTHER, docs).map((d) => d._id),
            ["a1"]
        );
        assert.deepEqual(
            filterVisibleObservations(RECORDER, docs).map((d) => d._id),
            ["a1", "a2"]
        );
        assert.equal(observationVisibleTo(ADMIN, hiddenDoc), false);
        assert.equal(observationVisibleTo(RECORDER, hiddenDoc), true);
    });

    test("charts exclude hidden for non-recorders; unhide restores", () => {
        const all = [visibleDoc, hiddenDoc];
        const adminVisible = filterVisibleObservations(ADMIN, all);
        const adminStats = computeCohortStatsFromAssessments(adminVisible, "teacherId");
        assert.equal(adminStats.science.avgMax, 10);

        const recorderVisible = filterVisibleObservations(RECORDER, all);
        const recorderStats = computeCohortStatsFromAssessments(recorderVisible, "teacherId");
        assert.equal(recorderStats.science.avgMax, 50);

        const unhidden = { ...hiddenDoc, hidden: false };
        const restored = filterVisibleObservations(ADMIN, [visibleDoc, unhidden]);
        const restoredStats = computeCohortStatsFromAssessments(restored, "teacherId");
        assert.equal(restoredStats.science.avgMax, 50);
        assert.equal(restored.length, 2);
    });
});
