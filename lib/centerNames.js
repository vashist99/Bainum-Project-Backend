/**
 * Center names are stored as free-form strings on Teacher, Classroom,
 * Child, and assessment docs, so comparisons must tolerate case /
 * whitespace drift.
 */
export function normalizeCenterName(name) {
    return typeof name === "string" ? name.trim().toLowerCase() : "";
}

export function isSameCenter(a, b) {
    const na = normalizeCenterName(a);
    const nb = normalizeCenterName(b);
    return na.length > 0 && na === nb;
}
