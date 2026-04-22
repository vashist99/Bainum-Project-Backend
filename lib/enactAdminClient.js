import "../config/loadEnv.js";

const DEFAULT_BASE = "https://enact.education.ufl.edu";

function enactBaseUrl() {
    return (process.env.ENACT_API_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}

/** @type {string | null} */
let cachedAccessToken = null;
/** @type {number} */
let tokenExpiresAtMs = 0;
/** @type {Promise<string> | null} */
let loginInFlight = null;
/** @type {Map<string, number>} */
const recentToggleByKey = new Map();
const TOGGLE_DEDUPE_WINDOW_MS = 60_000;

export function clearEnactAdminAccessToken() {
    cachedAccessToken = null;
    tokenExpiresAtMs = 0;
}

/**
 * @returns {Promise<string>}
 */
export async function getEnactAdminAccessToken() {
    const email = process.env.ENACT_ADMIN_EMAIL?.trim();
    const password = process.env.ENACT_ADMIN_PASSWORD;
    if (!email || !password) {
        throw new Error("ENACT_ADMIN_EMAIL and ENACT_ADMIN_PASSWORD must be set for Enact admin API");
    }

    const skewMs = 60_000;
    if (cachedAccessToken && Date.now() < tokenExpiresAtMs - skewMs) {
        return cachedAccessToken;
    }

    if (loginInFlight) {
        return loginInFlight;
    }

    loginInFlight = (async () => {
        const url = `${enactBaseUrl()}/api/auth/login`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            body: JSON.stringify({ email, password }),
        });

        const raw = await res.text();
        let data;
        try {
            data = raw ? JSON.parse(raw) : {};
        } catch {
            data = {};
        }

        if (!res.ok) {
            throw new Error(`Enact login failed: ${res.status} ${raw?.slice(0, 200)}`);
        }

        const token =
            data.access_token ||
            data.accessToken ||
            data.token ||
            data.data?.access_token ||
            data.data?.token;

        if (!token || typeof token !== "string") {
            throw new Error("Enact login response missing access_token");
        }

        const expiresInSec =
            typeof data.expires_in === "number"
                ? data.expires_in
                : typeof data.expiresIn === "number"
                  ? data.expiresIn
                  : null;

        cachedAccessToken = token;
        tokenExpiresAtMs = expiresInSec
            ? Date.now() + expiresInSec * 1000
            : Date.now() + 55 * 60 * 1000;

        return token;
    })();

    try {
        return await loginInFlight;
    } finally {
        loginInFlight = null;
    }
}

/**
 * @param {unknown} data
 * @returns {unknown[]}
 */
function extractUsersList(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.users)) return data.users;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.results)) return data.results;
    return [];
}

/**
 * @param {unknown} row
 * @returns {string | number | null}
 */
function rowUserId(row) {
    if (row && typeof row === "object") {
        const o = /** @type {Record<string, unknown>} */ (row);
        const id = o.id ?? o.userId ?? o.user_id;
        if (typeof id === "number" || typeof id === "string") return id;
    }
    return null;
}

/**
 * @param {unknown} row
 * @returns {string | null}
 */
function rowEmail(row) {
    if (row && typeof row === "object") {
        const e = /** @type {Record<string, unknown>} */ (row).email;
        if (typeof e === "string") return e;
    }
    return null;
}

/**
 * @param {string} accessToken
 * @returns {Promise<Response>}
 */
async function fetchEnactAdminUsersOnce(accessToken) {
    const url = `${enactBaseUrl()}/api/admin/users`;
    return fetch(url, {
        method: "GET",
        headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
        },
    });
}

/**
 * @param {string} normalizedEmail
 * @returns {Promise<string | number | null>}
 */
export async function findEnactUserIdByEmail(normalizedEmail) {
    const want = normalizedEmail.trim().toLowerCase();
    const token = await getEnactAdminAccessToken();

    let res = await fetchEnactAdminUsersOnce(token);
    if (res.status === 401) {
        clearEnactAdminAccessToken();
        const t2 = await getEnactAdminAccessToken();
        res = await fetchEnactAdminUsersOnce(t2);
    }

    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Enact GET /api/admin/users failed: ${res.status} ${t?.slice(0, 200)}`);
    }

    const data = await res.json().catch(() => ({}));
    const list = extractUsersList(data);

    for (const row of list) {
        const em = rowEmail(row);
        if (em && em.trim().toLowerCase() === want) {
            return rowUserId(row);
        }
    }

    return null;
}

/**
 * @param {string | number} enactUserId
 * @param {string} baniumChildId
 * @returns {Promise<{ ok: boolean, status: number, body?: unknown }>}
 */
export async function patchEnactToggleRecording(enactUserId, baniumChildId) {
    const token = await getEnactAdminAccessToken();
    const url = `${enactBaseUrl()}/api/admin/users/${encodeURIComponent(String(enactUserId))}/toggle-recording`;

    const doPatch = (accessToken) =>
        fetch(url, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ baniumChildId }),
        });

    let res = await doPatch(token);
    if (res.status === 401) {
        clearEnactAdminAccessToken();
        const t2 = await getEnactAdminAccessToken();
        res = await doPatch(t2);
    }

    let body;
    try {
        body = await res.json();
    } catch {
        body = undefined;
    }

    return { ok: res.ok, status: res.status, body };
}

/**
 * Best-effort: enable Enact recording for a parent who registered in Bainum.
 * Does not throw; logs warnings on failure.
 * @param {{ email: string, baniumChildId: string }} opts
 */
export async function enableEnactRecordingForBainumParent(opts) {
    const { email, baniumChildId } = opts;
    if (!email?.trim() || !baniumChildId?.trim()) {
        console.warn("[Enact] enable recording skipped: missing email or baniumChildId");
        return;
    }

    if (!process.env.ENACT_ADMIN_EMAIL?.trim() || !process.env.ENACT_ADMIN_PASSWORD) {
        console.warn(
            "[Enact] enable recording skipped: ENACT_ADMIN_EMAIL / ENACT_ADMIN_PASSWORD not configured"
        );
        return;
    }

    const dedupeKey = `${email.trim().toLowerCase()}::${baniumChildId.trim()}`;
    const now = Date.now();
    const recentAt = recentToggleByKey.get(dedupeKey);
    if (recentAt && now - recentAt < TOGGLE_DEDUPE_WINDOW_MS) {
        console.log("[Enact] toggle-recording skipped (deduped)", {
            email: email.trim(),
            baniumChildId: baniumChildId.trim(),
        });
        return;
    }
    recentToggleByKey.set(dedupeKey, now);

    try {
        const enactUserId = await findEnactUserIdByEmail(email);
        if (enactUserId == null) {
            console.warn("[Enact] enable recording: no Enact user id found for email", {
                email: email.trim(),
            });
            return;
        }

        const result = await patchEnactToggleRecording(enactUserId, baniumChildId.trim());
        if (!result.ok) {
            console.warn("[Enact] toggle-recording failed", {
                status: result.status,
                email: email.trim(),
                enactUserId,
                baniumChildId: baniumChildId.trim(),
                body: result.body,
            });
            return;
        }

        console.log("[Enact] toggle-recording succeeded", {
            email: email.trim(),
            enactUserId,
            baniumChildId: baniumChildId.trim(),
        });
    } catch (err) {
        console.error("[Enact] enable recording error", {
            message: err.message,
            email: email.trim(),
            baniumChildId: baniumChildId.trim(),
        });
    }
}
