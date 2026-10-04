import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeLanguageFeatures, languageFeaturesForTranscript, __setLanguageFeatureComputeForTests } from "../../lib/languageFeatures.js";

const ALPHABET = "What letter is this? What letter is this? What letter is this? It's M. Find the letter M. Find the letter M.";
const LADYBUG = "A ladybug is symmetrical, which means it has the same number of dots on each side. Why do you think it has dots? Let's count them together.";

function featuresOf(text) {
    return computeLanguageFeatures(text).languageFeatures;
}

describe("computeLanguageFeatures", () => {
    test("repetitive alphabet talk counts every what-question and stays short", () => {
        const alphabet = featuresOf(ALPHABET);
        const knowledge = featuresOf(LADYBUG);
        assert.equal(alphabet.whQuestionCount, 3);
        assert.ok(alphabet.uniqueWordCount < alphabet.uniqueWordCount / alphabet.varietyRatio);
        assert.ok(alphabet.meanUtteranceLength < knowledge.meanUtteranceLength);
    });

    test("knowledge-building talk has a question, a big-idea phrase, and a connecting word", () => {
        const features = featuresOf(LADYBUG);
        assert.ok(features.whQuestionCount >= 1);
        assert.ok(features.genericPhraseCount >= 1);
        assert.ok(features.conjunctionCount >= 1);
    });

    test("empty transcript is zeros and null rates", () => {
        const features = featuresOf("");
        assert.equal(features.uniqueWordCount, 0);
        assert.equal(features.utteranceCount, 0);
        assert.equal(features.whQuestionCount, 0);
        assert.equal(features.varietyRatio, null);
        assert.equal(features.meanUtteranceLength, null);
        assert.equal(features.schemaVersion, 1);
    });

    test("placeholders are not different words", () => {
        const features = featuresOf("[PERSON] [EMAIL]");
        assert.equal(features.uniqueWordCount, 0);
    });

    test("no punctuation still splits on lines and wide spaces", () => {
        const features = featuresOf("one two three    four five\nsix seven");
        assert.equal(features.utteranceCount, 3);
    });

    test("yes/no questions are excluded", () => {
        const features = featuresOf("Can you find the letter?");
        assert.equal(features.whQuestionCount, 0);
    });

    test("repeated what-questions each count", () => {
        const features = featuresOf("What letter is this? What letter is this? What letter is this?");
        assert.equal(features.whQuestionCount, 3);
    });

    test("question stems do not force a category", () => {
        const { languageFeatures, categoryLanguageFeatures } = computeLanguageFeatures("Why?");
        assert.equal(languageFeatures.whQuestionCount, 1);
        for (const category of ["science", "social", "literature", "language"]) {
            assert.equal(categoryLanguageFeatures[category].whQuestionCount, 0);
        }
    });

    test("letter question goes to language", () => {
        const { categoryLanguageFeatures } = computeLanguageFeatures("What letter is this?");
        assert.equal(categoryLanguageFeatures.language.whQuestionCount, 1);
        assert.equal(categoryLanguageFeatures.science.whQuestionCount, 0);
    });

    test("plant question goes to science", () => {
        const { categoryLanguageFeatures } = computeLanguageFeatures("Why did the plant grow?");
        assert.equal(categoryLanguageFeatures.science.whQuestionCount, 1);
        assert.equal(categoryLanguageFeatures.social.whQuestionCount, 0);
    });

    test("share question goes to social", () => {
        const { categoryLanguageFeatures } = computeLanguageFeatures("Why do you think we should share?");
        assert.equal(categoryLanguageFeatures.social.whQuestionCount, 1);
        assert.equal(categoryLanguageFeatures.science.whQuestionCount, 0);
    });

    test("a thrown computation leaves Layer 1 null", () => {
        __setLanguageFeatureComputeForTests(() => {
            throw new Error("boom");
        });
        try {
            const result = languageFeaturesForTranscript("Why did the plant grow?");
            assert.equal(result.languageFeatures, null);
            assert.equal(result.categoryLanguageFeatures, null);
        } finally {
            __setLanguageFeatureComputeForTests(null);
        }
    });
});
