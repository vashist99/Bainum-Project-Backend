import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    PREDEFINED_LOCATION_GROUPS,
    isPredefinedLocation,
    validateCustomLocation,
    resolveValidatedLocation,
} from "../../lib/locationValidator.js";

describe("locationValidator – catalogs", () => {
    test("home catalog matches the spec list exactly", () => {
        assert.deepEqual(PREDEFINED_LOCATION_GROUPS.home, [
            "Mealtime or snacks",
            "Personal Care (e.g., dressing, bathing, brushing teeth)",
            "Play/free play (e.g., blocks, puzzles, cars & trucks)",
            "Screen time (e.g., show, iPad / tablet / video games)",
            "Reading or looking at books",
            "Outdoor play (e.g., playing soccer, swinging)",
            "Clean up (e.g., picking up toys)",
            "Structured Activities (non-free play activities such as circle time, art, small group)",
        ]);
    });

    test("school catalog matches the spec list exactly", () => {
        assert.deepEqual(PREDEFINED_LOCATION_GROUPS.school, [
            "Classroom",
            "Excursion",
            "Playground",
            "Lab",
            "Library",
        ]);
    });
});

describe("locationValidator – isPredefinedLocation", () => {
    test("matches tolerate case, whitespace, and punctuation drift", () => {
        assert.ok(isPredefinedLocation("  classroom ", "school"));
        assert.ok(isPredefinedLocation("PLAYGROUND", "school"));
        assert.ok(isPredefinedLocation("mealtime or snacks", "home"));
        assert.ok(isPredefinedLocation("Play/free play (e.g., blocks, puzzles, cars & trucks)", "home"));
    });

    test("context isolation: parent-only locations are not school-predefined", () => {
        assert.ok(isPredefinedLocation("Mealtime or snacks", "home"));
        assert.ok(!isPredefinedLocation("Mealtime or snacks", "school"));
        assert.ok(!isPredefinedLocation("Classroom", "home"));
    });

    test("Library is predefined in school context only", () => {
        assert.ok(!isPredefinedLocation("Library", "home"));
        assert.ok(isPredefinedLocation("Library", "school"));
    });

    test("no context matches across both lists", () => {
        assert.ok(isPredefinedLocation("Mealtime or snacks"));
        assert.ok(isPredefinedLocation("Excursion"));
        assert.ok(!isPredefinedLocation("Mars Base"));
    });

    test("empty values never match", () => {
        assert.ok(!isPredefinedLocation("", "home"));
        assert.ok(!isPredefinedLocation(null, "school"));
        assert.ok(!isPredefinedLocation(undefined));
    });
});

describe("locationValidator – validateCustomLocation guard rails", () => {
    test("rejects empty location", async () => {
        const result = await validateCustomLocation("", "home");
        assert.ok(!result.accepted);
        assert.match(result.reason, /enter a location/i);
    });

    test("rejects over-long location", async () => {
        const result = await validateCustomLocation("x".repeat(121), "home");
        assert.ok(!result.accepted);
        assert.match(result.reason, /120 characters/i);
    });

    test("rejects invalid context", async () => {
        const result = await validateCustomLocation("Park", "office");
        assert.ok(!result.accepted);
        assert.match(result.reason, /invalid context/i);
    });

    test("predefined location accepted without LLM", async () => {
        const result = await validateCustomLocation("Playground", "school");
        assert.ok(result.accepted);
        assert.equal(result.normalized, "Playground");
    });

    test("custom location without LLM configured is rejected with guidance", async (t) => {
        if (process.env.OPENAI_API_KEY) {
            t.skip("OPENAI_API_KEY set — LLM path would be exercised for real");
            return;
        }
        const result = await validateCustomLocation("Grandma's backyard", "home");
        assert.ok(!result.accepted);
        assert.match(result.reason, /predefined locations/i);
    });
});

describe("locationValidator – resolveValidatedLocation", () => {
    test("absent location is ok and null", async () => {
        assert.deepEqual(await resolveValidatedLocation("", "home"), { ok: true, location: null });
        assert.deepEqual(await resolveValidatedLocation(null, "school"), { ok: true, location: null });
        assert.deepEqual(await resolveValidatedLocation(undefined, "school"), { ok: true, location: null });
    });

    test("predefined location passes through trimmed", async () => {
        const result = await resolveValidatedLocation("  Classroom  ", "school");
        assert.deepEqual(result, { ok: true, location: "Classroom" });
    });

    test("cross-context predefined value is not silently accepted", async (t) => {
        if (process.env.OPENAI_API_KEY) {
            t.skip("OPENAI_API_KEY set — would call the LLM");
            return;
        }
        // "Mealtime or snacks" is parent-only; for school context it must go through vetting,
        // which without an LLM configured means rejection.
        const result = await resolveValidatedLocation("Mealtime or snacks", "school");
        assert.ok(!result.ok);
    });
});
