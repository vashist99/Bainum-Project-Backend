/**
 * Centralized transcript retention policy.
 *
 * Every newly written Assessment / TeacherAssessment row that carries a
 * transcript stamps `transcriptExpiresAt = transcriptExpiryFrom(date)` so
 * the purge job and the visibility filter in whisperRoutes.js / api/index.js
 * can do one indexed check.
 *
 * The retention window lives in exactly one place so future tweaks
 * (extension, regulatory changes, per-tenant overrides) are a one-line
 * change. Both the constant and the helper are imported by callers — do
 * NOT inline `new Date(...).setDate(...)` elsewhere.
 */

export const TRANSCRIPT_RETENTION_DAYS = 365;

/**
 * Return the expiry timestamp for a transcript recorded at `date`.
 *
 * Uses `setDate(+TRANSCRIPT_RETENTION_DAYS)` rather than
 * `setFullYear(+1)` so a Feb-29 recording rolls onto Feb-28 of the next
 * year instead of producing an invalid date that wedges the write.
 *
 * @param {Date | string | number} date
 * @returns {Date}
 */
export function transcriptExpiryFrom(date) {
    const base = date instanceof Date ? new Date(date.getTime()) : new Date(date);
    if (Number.isNaN(base.getTime())) {
        throw new TypeError("transcriptExpiryFrom: invalid date");
    }
    base.setDate(base.getDate() + TRANSCRIPT_RETENTION_DAYS);
    return base;
}
