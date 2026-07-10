import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    isStaffRole,
    staffHomeContextFilter,
    isHomeAssessment,
} from "../../lib/talkDataAccess.js";

describe("talkDataAccess — home talk privacy helpers", () => {
    test("teachers and admins are staff; parents are not", () => {
        assert.equal(isStaffRole("teacher"), true);
        assert.equal(isStaffRole("admin"), true);
        assert.equal(isStaffRole("parent"), false);
        assert.equal(isStaffRole(undefined), false);
    });

    test("staff filter excludes home rows and keeps school + legacy rows", () => {
        const filter = staffHomeContextFilter();
        assert.deepEqual(filter, { activityContext: { $ne: "home" } });

        // Mirror Mongo's $ne semantics: matches when the field is absent,
        // null, or any value other than 'home'.
        const matches = (doc) => doc.activityContext !== "home";
        assert.equal(matches({ activityContext: "home" }), false);
        assert.equal(matches({ activityContext: "school" }), true);
        assert.equal(matches({}), true);
        assert.equal(matches({ activityContext: null }), true);
    });

    test("isHomeAssessment flags only home-context rows", () => {
        assert.equal(isHomeAssessment({ activityContext: "home" }), true);
        assert.equal(isHomeAssessment({ activityContext: "school" }), false);
        assert.equal(isHomeAssessment({}), false);
        assert.equal(isHomeAssessment(null), false);
    });
});
