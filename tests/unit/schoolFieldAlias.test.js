import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    readSchoolFromBody,
    withSchoolField,
    formatSchoolRegistryEntity,
    schoolEntityKey,
    schoolListKey,
} from "../../lib/schoolFieldAlias.js";

describe("readSchoolFromBody", () => {
    test("prefers school over center", () => {
        assert.equal(
            readSchoolFromBody({ school: "Sunrise", center: "Other" }),
            "Sunrise"
        );
    });

    test("falls back to center", () => {
        assert.equal(readSchoolFromBody({ center: "Sunrise" }), "Sunrise");
    });

    test("returns undefined when missing", () => {
        assert.equal(readSchoolFromBody({}), undefined);
    });
});

describe("withSchoolField", () => {
    test("adds school mirroring center", () => {
        const out = withSchoolField({ name: "Kid", center: "Sunrise" });
        assert.equal(out.school, "Sunrise");
        assert.equal(out.center, "Sunrise");
    });
});

describe("formatSchoolRegistryEntity", () => {
    test("maps name to school", () => {
        const out = formatSchoolRegistryEntity({
            _id: "abc",
            name: "Sunrise Academy",
            address: "1 Main",
        });
        assert.equal(out.school, "Sunrise Academy");
        assert.equal(out.name, "Sunrise Academy");
    });
});

describe("school API mount keys", () => {
    test("schools mount uses school keys", () => {
        const req = { useSchoolsNomenology: true };
        assert.equal(schoolEntityKey(req), "school");
        assert.equal(schoolListKey(req), "schools");
    });

    test("legacy mount uses center keys", () => {
        const req = {};
        assert.equal(schoolEntityKey(req), "center");
        assert.equal(schoolListKey(req), "centers");
    });
});
