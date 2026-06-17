import { normalizeLabelKey, validateLabelWithLLM } from "./labelValidator.js";

/**
 * Curated location catalogs for each recording context.
 *
 *  - `home`   shown to parents (where the family recording happened)
 *  - `school` shown to teachers and admins (where the classroom recording happened)
 *
 * Locations listed here bypass the LLM check. "Other (please specify)" in the
 * UI opens a free-text field that goes through `validateCustomLocation`.
 *
 * Keep this list in sync with `mockup1/src/utils/locations.js`.
 */
export const PREDEFINED_LOCATION_GROUPS = {
    home: [
        "Mealtime or snacks",
        "Personal Care (e.g., dressing, bathing, brushing teeth)",
        "Play/free play (e.g., blocks, puzzles, cars & trucks)",
        "Screen time (e.g., show, iPad / tablet / video games)",
        "Reading or looking at books",
        "Outdoor play (e.g., playing soccer, swinging)",
        "Clean up (e.g., picking up toys)",
        "Structured Activities (non-free play activities such as circle time, art, small group)",
    ],
    school: [
        "Classroom",
        "Excursion",
        "Playground",
        "Lab",
        "Library",
    ],
};

const PREDEFINED_KEYS_BY_CONTEXT = { home: new Set(), school: new Set() };
for (const ctx of Object.keys(PREDEFINED_LOCATION_GROUPS)) {
    for (const location of PREDEFINED_LOCATION_GROUPS[ctx]) {
        PREDEFINED_KEYS_BY_CONTEXT[ctx].add(normalizeLabelKey(location));
    }
}

/**
 * Check whether a location is in the predefined catalog.
 *
 * @param {string} location
 * @param {"school"|"home"|null|undefined} context When provided, only matches against
 *   that context's list (e.g. a teacher cannot bypass LLM checks by submitting a
 *   parent-only location like "Home"). When omitted, matches across both lists.
 * @returns {boolean}
 */
export function isPredefinedLocation(location, context = null) {
    const key = normalizeLabelKey(location);
    if (!key) return false;
    if (context === "home" || context === "school") {
        return PREDEFINED_KEYS_BY_CONTEXT[context].has(key);
    }
    return (
        PREDEFINED_KEYS_BY_CONTEXT.home.has(key) ||
        PREDEFINED_KEYS_BY_CONTEXT.school.has(key)
    );
}

/**
 * Validate an optional recording location for an accept/transcribe request.
 * Returns { ok: true, location } (normalized, or null when absent) or
 * { ok: false, message } when a non-predefined location fails vetting.
 * Shared by the activity and classroom flows so the server-side anti-bypass
 * check can't drift between them.
 */
export async function resolveValidatedLocation(rawLocation, context) {
    const trimmed = String(rawLocation || "").trim();
    if (!trimmed) return { ok: true, location: null };
    if (isPredefinedLocation(trimmed, context)) {
        return { ok: true, location: trimmed };
    }
    const decision = await validateCustomLocation(trimmed, context);
    if (!decision.accepted) {
        return {
            ok: false,
            message: decision.reason || "Custom location was not accepted for this context.",
        };
    }
    return { ok: true, location: decision.normalized || trimmed };
}

/**
 * Validate a free-text location against the expected context.
 *
 * @param {string} location Raw location text typed by the user
 * @param {"school"|"home"} context Where the recording must have taken place
 * @returns {Promise<{accepted: boolean, reason: string, normalized?: string}>}
 */
export async function validateCustomLocation(location, context) {
    const trimmed = String(location || "").trim();
    if (!trimmed) {
        return { accepted: false, reason: "Please enter a location." };
    }
    if (trimmed.length > 120) {
        return { accepted: false, reason: "Location must be 120 characters or fewer." };
    }
    if (context !== "school" && context !== "home") {
        return { accepted: false, reason: "Invalid context." };
    }

    if (isPredefinedLocation(trimmed, context)) {
        return { accepted: true, reason: "Predefined location.", normalized: trimmed };
    }

    const contextDescription =
        context === "school"
            ? "a recording made by a teacher during the school day at an early-childhood / PreK program (e.g., the classroom, the playground, a lab or library inside the school, or an excursion / field-trip destination)."
            : "a recording made by a parent or family caregiver during everyday family life (e.g., mealtime, personal care routines, free play, screen time, reading together, outdoor play, clean-up, or structured home activities).";

    const systemPrompt = `You decide whether a short location label describes a real-world place where a young child (under 8) could plausibly be during ${contextDescription}

Respond ONLY with strict JSON: {"accepted": boolean, "reason": "<short human-readable explanation>", "normalized": "<cleaned-up location name, Title Case>"}.
- accepted=true only when the label clearly names a plausible physical place or setting for this context.
- accepted=false when the label is not a place (e.g., "fun", "yesterday"), is implausible or nonsensical (e.g., "the moon"), is offensive/unsafe, doesn't fit the requested context (e.g., a teacher submitting "bathtub at home"), or is too vague to be useful (e.g., "somewhere").
- Keep "reason" concise (max ~25 words). Do not include any text outside the JSON object.`;

    const userPrompt = `Location: ${JSON.stringify(trimmed)}\nExpected context: ${context}`;

    return validateLabelWithLLM({
        value: trimmed,
        systemPrompt,
        userPrompt,
        unavailableMessage:
            "Custom locations can't be validated right now (LLM not configured). Please pick one of the predefined locations.",
        defaultAcceptedReason: "Looks like a valid location.",
        defaultRejectedReason: "Location doesn't fit the expected context.",
        logTag: "locationValidator",
    });
}
