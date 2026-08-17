/**
 * Structured-PII span detectors (Presidio-inspired patterns, MIT).
 * Returns { start, end, type } character spans; does not mutate the input.
 */

export const PATTERN_TYPES = Object.freeze({
    EMAIL: "EMAIL",
    PHONE: "PHONE",
    SSN: "SSN",
    CREDIT_CARD: "CREDIT_CARD",
    ADDRESS: "ADDRESS",
    DATE_OF_BIRTH: "DATE_OF_BIRTH",
});

const EMAIL_RE =
    /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

const PHONE_RE =
    /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}\b/g;

const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

const CREDIT_CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;

const STREET_SUFFIX =
    "(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Place|Pl|Way|Parkway|Pkwy)\\.?";

const ADDRESS_RE = new RegExp(
    `\\b\\d{1,5}\\s+(?:[A-Za-z0-9.'-]+\\s+){0,4}${STREET_SUFFIX}\\b`,
    "gi"
);

const MONTHS =
    "(?:January|February|March|April|May|June|July|August|September|October|November|December)";

const BORN_ON_RE = new RegExp(
    `\\bborn\\s+on\\s+(?:${MONTHS}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}[/\\-]\\d{1,2}[/\\-]\\d{2,4})`,
    "gi"
);

const NUMERIC_DATE_RE =
    /\b(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}\b/g;

/**
 * @param {string} digits
 * @returns {boolean}
 */
export function luhnOk(digits) {
    if (!digits || digits.length < 13 || digits.length > 19) return false;
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i -= 1) {
        let n = Number(digits[i]);
        if (Number.isNaN(n)) return false;
        if (alt) {
            n *= 2;
            if (n > 9) n -= 9;
        }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
}

/**
 * @param {string} text
 * @param {RegExp} regex
 * @param {string} type
 * @param {(match: string) => boolean} [accept]
 * @returns {Array<{ start: number, end: number, type: string }>}
 */
function collect(text, regex, type, accept) {
    const spans = [];
    const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
    let match;
    while ((match = re.exec(text)) !== null) {
        const value = match[0];
        if (accept && !accept(value)) continue;
        spans.push({
            start: match.index,
            end: match.index + value.length,
            type,
        });
        if (match[0].length === 0) re.lastIndex += 1;
    }
    return spans;
}

/**
 * @param {string} text
 * @returns {Array<{ start: number, end: number, type: string }>}
 */
export function findPatternSpans(text) {
    if (!text || typeof text !== "string") return [];

    const spans = [
        ...collect(text, EMAIL_RE, PATTERN_TYPES.EMAIL),
        ...collect(text, SSN_RE, PATTERN_TYPES.SSN),
        ...collect(text, PHONE_RE, PATTERN_TYPES.PHONE, (value) => {
            const digits = value.replace(/\D/g, "");
            if (digits.length === 9) return false;
            if (digits.length < 10) return false;
            return true;
        }),
        ...collect(text, CREDIT_CARD_RE, PATTERN_TYPES.CREDIT_CARD, (value) => {
            const digits = value.replace(/\D/g, "");
            return luhnOk(digits);
        }),
        ...collect(text, ADDRESS_RE, PATTERN_TYPES.ADDRESS),
        ...collect(text, BORN_ON_RE, PATTERN_TYPES.DATE_OF_BIRTH),
        ...collect(text, NUMERIC_DATE_RE, PATTERN_TYPES.DATE_OF_BIRTH),
    ];

    return spans;
}
