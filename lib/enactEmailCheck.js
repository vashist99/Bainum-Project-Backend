import "../config/loadEnv.js";

const DEFAULT_CHECK_BASE = "https://enact.education.ufl.edu/api/auth/check-email";

/**
 * @typedef {{ ok: true, exists: boolean } | { ok: false }} EnactCheckEmailResult
 */

/**
 * Calls Enact check-email once. `ok: false` on network/parse/non-OK HTTP.
 * @param {string} email
 * @returns {Promise<EnactCheckEmailResult>}
 */
export async function fetchEnactCheckEmail(email) {
    const base = (process.env.ENACT_CHECK_EMAIL_URL || DEFAULT_CHECK_BASE).replace(/\/$/, "");
    const url = `${base}?email=${encodeURIComponent(email.trim())}`;
    try {
        const res = await fetch(url, {
            method: "GET",
            headers: { Accept: "application/json" },
        });
        if (!res.ok) {
            console.warn("[Enact] check-email non-OK response", {
                status: res.status,
                email: email.trim(),
            });
            return { ok: false };
        }
        const data = await res.json();
        if (typeof data?.exists !== "boolean") {
            console.warn("[Enact] check-email unexpected JSON", { email: email.trim() });
            return { ok: false };
        }
        return { ok: true, exists: data.exists };
    } catch (err) {
        console.warn("[Enact] check-email failed", {
            message: err.message,
            email: email.trim(),
        });
        return { ok: false };
    }
}

/**
 * Whether the parent email already exists in the Enact system.
 * On network or parse errors, returns true so invitations still use the standard flow.
 * @param {string} email
 * @returns {Promise<boolean>}
 */
export async function enactParentEmailExists(email) {
    const r = await fetchEnactCheckEmail(email);
    if (!r.ok) return true;
    return r.exists;
}
