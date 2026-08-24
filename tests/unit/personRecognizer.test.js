import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { resolvePersonRecognizerMode } from "../../lib/pii/personRecognizer.js";

describe("resolvePersonRecognizerMode", () => {
    test("explicit compromise wins on Render", () => {
        assert.equal(
            resolvePersonRecognizerMode({ explicit: "compromise", onRender: true }),
            "compromise"
        );
    });

    test("explicit transformers can still be forced on Render", () => {
        assert.equal(
            resolvePersonRecognizerMode({ explicit: "transformers", onRender: true }),
            "transformers"
        );
    });

    test("Render defaults to compromise so BERT is not loaded after STT", () => {
        assert.equal(
            resolvePersonRecognizerMode({ explicit: "", onRender: true }),
            "compromise"
        );
    });

    test("non-Render defaults to transformers", () => {
        assert.equal(
            resolvePersonRecognizerMode({ explicit: "", onRender: false }),
            "transformers"
        );
    });
});
