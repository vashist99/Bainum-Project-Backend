import { normalizeLabelKey, validateLabelWithLLM } from "./labelValidator.js";

/**
 * Curated activity catalogs for each recording context.
 *
 *  - `home`   shown to parents (recording happens at home with family)
 *  - `school` shown to teachers (recording happens in an early-childhood / PreK
 *             classroom for ages 3–5)
 *
 * Activities listed here bypass the LLM check. Anything outside is treated as a
 * custom activity and goes through `validateCustomActivity` so teachers can only
 * record school-context activities and parents can only record home-context ones.
 *
 * Keep this list in sync with `mockup1/src/utils/activities.js`.
 */
export const PREDEFINED_ACTIVITY_GROUPS = {
    home: [
        {
            category: "Play time",
            activities: [
                "Puzzles",
                "Blocks",
                "Pretend play",
                "Games",
                "Baby dolls",
                "Cars",
                "Sensory toys",
                "Playing (general)",
                "Sports (e.g., soccer, basketball)",
                "Screen time (e.g., movie/show, iPad/tablet/phone, video games)",
            ],
        },
        {
            category: "Personal care",
            activities: [
                "Waking up",
                "Diapering",
                "Potty time",
                "Dressing",
                "Nap time",
                "Brushing teeth",
                "Bath time",
                "Bed time",
                "Sleeping",
            ],
        },
        {
            category: "Outdoor play",
            activities: [
                "Ride-ons",
                "Playing ball",
                "Swinging",
                "Sliding",
                "Water play",
            ],
        },
        {
            category: "Eating & drinking",
            activities: [
                "Bottle time",
                "Breakfast",
                "Lunch",
                "Dinner",
                "Snacks",
                "Water breaks",
            ],
        },
        {
            category: "Outings",
            activities: [
                "Car rides",
                "Bus rides",
                "Walks",
                "Visiting family and friends",
                "Shopping",
                "Getting the mail",
                "Traveling to/from activity",
            ],
        },
        {
            category: "Household chores",
            activities: [
                "Laundry",
                "Wiping up tables",
                "Throwing away trash",
                "Picking up toys",
                "Putting dishes in sink",
                "Clean-up, set-up, transition",
            ],
        },
        {
            category: "Books & literacy",
            activities: [
                "Reading together",
                "Playing with cloth or board books",
                "Talking about pictures",
                "Reading or looking at books",
            ],
        },
        {
            category: "Structured activities",
            activities: [
                "Circle time",
                "Music time",
                "Library story time",
                "Story time",
                "Art",
                "Playdough",
                "Coloring",
                "Centers",
                "Large group",
                "Small group",
                "Individual activity",
                "Other",
                "School work",
                "Faith-based activities",
                "Therapy",
            ],
        },
    ],

    school: [
        {
            category: "Arrival, transitions & routines",
            activities: [
                "Arrival / drop-off",
                "Morning greeting / sign-in",
                "Hand washing",
                "Bathroom break",
                "Diapering",
                "Line up",
                "Hallway transition",
                "Dismissal / pick-up",
            ],
        },
        {
            category: "Circle time & group meetings",
            activities: [
                "Circle time",
                "Morning meeting",
                "Calendar time",
                "Weather chart",
                "Attendance",
                "Question of the day",
                "Show and tell",
                "Class meeting",
            ],
        },
        {
            category: "Literacy & books",
            activities: [
                "Story time / read aloud",
                "Shared reading",
                "Letter & phonics activities",
                "Rhyming and word games",
                "Alphabet practice",
                "Writing or journaling",
                "Library / listening center",
                "Talking about pictures",
            ],
        },
        {
            category: "Math, science & sensory",
            activities: [
                "Counting and number games",
                "Sorting and patterning",
                "Shape and color activities",
                "Measuring activities",
                "Math manipulatives",
                "Science experiments",
                "Nature exploration",
                "Sensory table",
                "Sensory bin",
            ],
        },
        {
            category: "Art, music & movement",
            activities: [
                "Art and crafts",
                "Coloring",
                "Painting",
                "Drawing",
                "Playdough or clay",
                "Collage",
                "Cutting and gluing",
                "Music time",
                "Singing",
                "Dancing",
                "Movement games",
                "Musical instruments",
            ],
        },
        {
            category: "Centers & free play",
            activities: [
                "Free play / free choice",
                "Blocks center",
                "Dramatic play / pretend play",
                "Kitchen / housekeeping center",
                "Construction and building",
                "Puzzles and manipulatives",
                "Cars and trucks",
                "Sand or water play",
            ],
        },
        {
            category: "Meals, snacks & outdoor play",
            activities: [
                "Breakfast",
                "Morning snack",
                "Lunch",
                "Afternoon snack",
                "Outdoor play / recess",
                "Playground time",
                "Riding tricycles or ride-ons",
                "Ball games",
                "Climbing structures",
                "Garden time",
            ],
        },
        {
            category: "Rest, services & special events",
            activities: [
                "Nap time",
                "Quiet / rest time",
                "Speech therapy",
                "Occupational therapy",
                "Physical therapy",
                "Small group instruction",
                "Large group instruction",
                "Individual instruction",
                "Field trip",
                "Class celebration / holiday",
            ],
        },
    ],
};

/** Case-insensitive, whitespace/punctuation-tolerant key for predefined matches. */
const normalizeActivityKey = normalizeLabelKey;

const PREDEFINED_KEYS_BY_CONTEXT = { home: new Set(), school: new Set() };
for (const ctx of Object.keys(PREDEFINED_ACTIVITY_GROUPS)) {
    for (const group of PREDEFINED_ACTIVITY_GROUPS[ctx]) {
        for (const activity of group.activities) {
            PREDEFINED_KEYS_BY_CONTEXT[ctx].add(normalizeActivityKey(activity));
        }
    }
}

/**
 * Check whether an activity is in the predefined catalog.
 *
 * @param {string} activity
 * @param {"school"|"home"|null|undefined} context When provided, only matches against
 *   that context's list (e.g. a teacher cannot bypass LLM checks by submitting a
 *   parent-only activity). When omitted, matches across both lists.
 * @returns {boolean}
 */
export function isPredefinedActivity(activity, context = null) {
    const key = normalizeActivityKey(activity);
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
 * Validate a free-text activity against the expected context.
 *
 * @param {string} activity Raw activity text typed by the user
 * @param {"school"|"home"} context Where the activity must take place
 * @returns {Promise<{accepted: boolean, reason: string, normalized?: string}>}
 */
export async function validateCustomActivity(activity, context) {
    const trimmed = String(activity || "").trim();
    if (!trimmed) {
        return { accepted: false, reason: "Please enter an activity." };
    }
    if (trimmed.length > 120) {
        return { accepted: false, reason: "Activity must be 120 characters or fewer." };
    }
    if (context !== "school" && context !== "home") {
        return { accepted: false, reason: "Invalid context." };
    }

    if (isPredefinedActivity(trimmed, context)) {
        return { accepted: true, reason: "Predefined activity.", normalized: trimmed };
    }

    const contextDescription =
        context === "school"
            ? "an early-childhood / PreK classroom for children aged 3–5 (e.g., circle time, calendar time, snack/lunch, hand washing, free-choice centers, blocks, dramatic play, story time, phonics, sensory table, art and playdough, music and movement, outdoor recess on the playground, nap/rest time, small/large/individual group instruction, speech/occupational/physical therapy, field trips, class celebrations)."
            : "the child's home with a parent or family caregiver (e.g., meals and snacks, bath time, diapering or potty time, dressing, bedtime routine, reading together, indoor play with blocks/puzzles/pretend play, screen time, backyard or outdoor play, household chores like laundry or picking up toys, outings such as shopping or walks, faith-based activities, therapy at home).";

    const systemPrompt = `You decide whether a short activity label describes something that would plausibly happen with a young child (under 8) in ${contextDescription}

Respond ONLY with strict JSON: {"accepted": boolean, "reason": "<short human-readable explanation>", "normalized": "<cleaned-up activity name, Title Case>"}.
- accepted=true only when the activity clearly fits this context.
- accepted=false when the activity is unrelated to early childhood (e.g., "drinking beer", "stock trading"), is offensive/unsafe, doesn't fit the requested location (e.g., a parent submitting "circle time" or a teacher submitting "bath time"), or is too vague to be useful (e.g., "stuff").
- Keep "reason" concise (max ~25 words). Do not include any text outside the JSON object.`;

    const userPrompt = `Activity: ${JSON.stringify(trimmed)}\nExpected context: ${context}`;

    return validateLabelWithLLM({
        value: trimmed,
        systemPrompt,
        userPrompt,
        unavailableMessage:
            "Custom activities can't be validated right now (LLM not configured). Please pick one of the predefined activities.",
        defaultAcceptedReason: "Looks like a valid activity.",
        defaultRejectedReason: "Activity doesn't fit the expected context.",
        logTag: "activityValidator",
    });
}
