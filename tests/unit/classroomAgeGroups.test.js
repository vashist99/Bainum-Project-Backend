import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    CLASSROOM_AGE_GROUPS,
    LEGACY_AGE_GROUPS,
    normalizeStoredAgeGroup,
    parseAgeGroup,
} from "../../lib/classroomHelpers.js";
import Classroom from "../../models/Classroom.js";

const LEAD_ID = "64b000000000000000000001";

describe("classroom age groups", () => {
    test("the allowed list is year ranges plus Mixed ages", () => {
        assert.deepEqual(CLASSROOM_AGE_GROUPS, ["0-1 YO", "1-2 YO", "2-3 YO", "3-4 YO", "4-5 YO", "Mixed ages"]);
    });

    test("new values parse and blank is unset", () => {
        assert.deepEqual(parseAgeGroup("3-4 YO"), { ok: true, ageGroup: "3-4 YO" });
        assert.deepEqual(parseAgeGroup(""), { ok: true, ageGroup: null });
        assert.deepEqual(parseAgeGroup(null), { ok: true, ageGroup: null });
    });

    test("former names are rejected on input", () => {
        for (const name of Object.keys(LEGACY_AGE_GROUPS)) {
            assert.equal(parseAgeGroup(name).ok, false, name);
        }
    });

    test("stored former names read as year ranges", () => {
        assert.equal(normalizeStoredAgeGroup("Infant"), "0-1 YO");
        assert.equal(normalizeStoredAgeGroup("Toddler"), "1-2 YO");
        assert.equal(normalizeStoredAgeGroup("Preschool"), "3-4 YO");
        assert.equal(normalizeStoredAgeGroup("Pre-K"), "4-5 YO");
        assert.equal(normalizeStoredAgeGroup("Mixed ages"), "Mixed ages");
        assert.equal(normalizeStoredAgeGroup(null), null);
    });

    test("saving a classroom that stores Pre-K converts it instead of failing validation", async () => {
        const doc = new Classroom({ name: "Owls", teacher: LEAD_ID, center: "Center A", ageGroup: "Pre-K" });
        await doc.validate();
        assert.equal(doc.ageGroup, "4-5 YO");
    });

    test("an unknown stored value still fails validation", async () => {
        const doc = new Classroom({ name: "Owls", teacher: LEAD_ID, center: "Center A", ageGroup: "Kindergarten" });
        await assert.rejects(doc.validate());
    });
});
