import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    isStaffRole,
    homeOnlyContextFilter,
    isHomeAssessment,
} from "../../lib/talkDataAccess.js";

describe("talkDataAccess — home talk privacy helpers", () => {
    test("teachers and admins are staff; parents are not", () => {
        assert.equal(isStaffRole("teacher"), true);
        assert.equal(isStaffRole("admin"), true);
        assert.equal(isStaffRole("parent"), false);
        assert.equal(isStaffRole(undefined), false);
    });

    test("home-only filter selects exactly the home-context rows", () => {
        const filter = homeOnlyContextFilter();
        assert.deepEqual(filter, { activityContext: "home" });

        const matches = (doc) => doc.activityContext === "home";
        assert.equal(matches({ activityContext: "home" }), true);
        assert.equal(matches({ activityContext: "school" }), false);
        assert.equal(matches({}), false);
        assert.equal(matches({ activityContext: null }), false);
    });

    test("isHomeAssessment flags only home-context rows", () => {
        assert.equal(isHomeAssessment({ activityContext: "home" }), true);
        assert.equal(isHomeAssessment({ activityContext: "school" }), false);
        assert.equal(isHomeAssessment({}), false);
        assert.equal(isHomeAssessment(null), false);
    });
});
