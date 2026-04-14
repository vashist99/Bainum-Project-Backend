/**
 * Server-to-server auth for assessment ingest endpoints.
 * Send the same value in `X-Api-Key` or `Authorization: Bearer <key>`.
 */
export default function requireIngestApiKey(req, res, next) {
    const configured = process.env.ASSESSMENT_INGEST_API_KEY?.trim();
    if (!configured) {
        return res.status(503).json({
            message: "Assessment ingest is not configured (set ASSESSMENT_INGEST_API_KEY on the server).",
        });
    }
    const headerKey = req.headers["x-api-key"];
    const auth = req.headers.authorization;
    const bearer =
        typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")
            ? auth.slice(7).trim()
            : null;
    const sent = (typeof headerKey === "string" ? headerKey.trim() : null) || bearer;
    if (!sent || sent !== configured) {
        return res.status(401).json({ message: "Invalid or missing API key" });
    }
    next();
}
