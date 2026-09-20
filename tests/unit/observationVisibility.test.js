import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    observationVisibleTo,
    canHideObservation,
    filterVisibleObservations,
    applyObservationNote,
    serializeObservationMeta,
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

describe("observation note — last write wins", () => {
    test("later save replaces text and authorship", () => {
        const doc = { observationNote: null };
        applyObservationNote(doc, RECORDER, "First look");
        assert.equal(doc.observationNote.text, "First look");
        assert.equal(doc.observationNote.authorName, "Riley");
        assert.equal(doc.observationNote.authorId, RECORDER.id);

        applyObservationNote(doc, ADMIN, "Admin revision");
        assert.equal(doc.observationNote.text, "Admin revision");
        assert.equal(doc.observationNote.authorName, "Ada");
        assert.equal(doc.observationNote.authorId, ADMIN.id);
    });

    test("empty text clears the shared note", () => {
        const doc = {};
        applyObservationNote(doc, RECORDER, "Keep");
        applyObservationNote(doc, OTHER, "   ");
        assert.equal(doc.observationNote.text, "");
        assert.equal(doc.observationNote.authorId, null);
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
