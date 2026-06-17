/**
 * Presentation-layer aliases: persisted `center` ↔ API `school`.
 * MongoDB field names stay `center`; user-facing nomenclature is "school".
 */

/** Read site name from request body (`school` preferred, `center` legacy). */
export function readSchoolFromBody(body) {
    if (!body || typeof body !== "object") return undefined;
    const raw = body.school ?? body.center;
    if (raw == null || String(raw).trim() === "") return undefined;
    return String(raw).trim();
}

/** True when mounted under `/api/schools` (vs legacy `/api/centers`). */
export function usesSchoolsApiMount(req) {
    return Boolean(req?.useSchoolsNomenology);
}

/** Entity wrapper key: `school` on /api/schools, `center` on legacy mount. */
export function schoolEntityKey(req) {
    return usesSchoolsApiMount(req) ? "school" : "center";
}

/** List wrapper key: `schools` on /api/schools, `centers` on legacy mount. */
export function schoolListKey(req) {
    return usesSchoolsApiMount(req) ? "schools" : "centers";
}

function toPlain(record) {
    if (!record) return record;
    if (typeof record.toObject === "function") return record.toObject();
    if (typeof record.toJSON === "function") return record.toJSON();
    return { ...record };
}

/**
 * Add `school` alongside `center` on objects that carry a site affiliation string.
 */
export function withSchoolField(record) {
    if (!record) return record;
    const plain = toPlain(record);
    if (plain.center == null || plain.center === "") {
        return plain;
    }
    return { ...plain, school: plain.center, center: plain.center };
}

export function mapSchoolCollection(items) {
    if (!Array.isArray(items)) return items;
    return items.map((item) => withSchoolField(item));
}

/** Serialize a Center registry document for API responses. */
export function formatSchoolRegistryEntity(doc) {
    const plain = toPlain(doc);
    return {
        id: plain._id,
        _id: plain._id,
        name: plain.name,
        school: plain.name,
        address: plain.address ?? "",
        phone: plain.phone ?? "",
        email: plain.email ?? "",
        description: plain.description ?? "",
        createdAt: plain.createdAt,
        updatedAt: plain.updatedAt,
    };
}

export function mapSchoolRegistryCollection(items) {
    if (!Array.isArray(items)) return items;
    return items.map((item) => formatSchoolRegistryEntity(item));
}
