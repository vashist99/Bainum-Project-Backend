import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    findPatternSpans,
    luhnOk,
    PATTERN_TYPES,
} from "../../lib/pii/patternRecognizers.js";

function typesIn(text) {
    return findPatternSpans(text).map((s) => s.type);
}

describe("patternRecognizers", () => {
    test("detects email addresses", () => {
        const spans = findPatternSpans("email me at parent@school.edu please");
        assert.equal(spans.length, 1);
        assert.equal(spans[0].type, PATTERN_TYPES.EMAIL);
        assert.equal("email me at parent@school.edu please".slice(spans[0].start, spans[0].end), "parent@school.edu");
    });

    test("detects US phone numbers", () => {
        const text = "Call 555-123-4567 or (555) 987-6543";
        const phones = findPatternSpans(text).filter((s) => s.type === PATTERN_TYPES.PHONE);
        assert.equal(phones.length, 2);
    });

    test("detects dashed SSNs and not ordinary 3-3-4 phones as SSN", () => {
        const ssn = findPatternSpans("SSN 123-45-6789");
        assert.ok(ssn.some((s) => s.type === PATTERN_TYPES.SSN));
        const phoneOnly = findPatternSpans("Call 555-123-4567");
        assert.equal(phoneOnly.filter((s) => s.type === PATTERN_TYPES.SSN).length, 0);
    });

    test("detects Luhn-valid credit cards and rejects invalid digit runs", () => {
        assert.equal(luhnOk("4111111111111111"), true);
        assert.equal(luhnOk("4111111111111112"), false);
        const spans = findPatternSpans("card 4111111111111111 on file");
        assert.ok(spans.some((s) => s.type === PATTERN_TYPES.CREDIT_CARD));
        const invalid = findPatternSpans("card 4111111111111112 on file");
        assert.equal(invalid.filter((s) => s.type === PATTERN_TYPES.CREDIT_CARD).length, 0);
    });

    test("detects US street addresses", () => {
        const spans = findPatternSpans("We live at 123 Main Street near the park");
        assert.ok(spans.some((s) => s.type === PATTERN_TYPES.ADDRESS));
        assert.equal(
            "We live at 123 Main Street near the park".slice(
                spans.find((s) => s.type === PATTERN_TYPES.ADDRESS).start,
                spans.find((s) => s.type === PATTERN_TYPES.ADDRESS).end
            ),
            "123 Main Street"
        );
    });

    test("detects numeric dates and born-on phrasing as DATE_OF_BIRTH", () => {
        assert.ok(typesIn("born on March 3rd, 2019").includes(PATTERN_TYPES.DATE_OF_BIRTH));
        assert.ok(typesIn("her birthday is 03/15/2019").includes(PATTERN_TYPES.DATE_OF_BIRTH));
    });

    test("does not treat ordinary calendar talk as DATE_OF_BIRTH", () => {
        assert.equal(typesIn("we played yesterday").includes(PATTERN_TYPES.DATE_OF_BIRTH), false);
        assert.equal(typesIn("circle time on Monday").includes(PATTERN_TYPES.DATE_OF_BIRTH), false);
        assert.equal(typesIn("see you next Friday").includes(PATTERN_TYPES.DATE_OF_BIRTH), false);
    });
});
