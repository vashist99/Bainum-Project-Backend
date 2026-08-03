import ActivityLog, {
    ACTIVITY_ACTIONS,
    LOGGED_ROLES,
} from "../models/ActivityLog.js";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;

/** Parse a positive integer query param with a default. */
function parsePositiveInt(value, fallback) {
    if (value == null || value === "") return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) return null;
    return n;
}

/**
 * GET /api/activity-log — admin-only (route enforces `viewActivityLog`).
 *
 * Query params: page (default 1), limit (default 25, max 100), actorId,
 * role ("teacher"|"coach"), action (ACTIVITY_ACTIONS), from, to (ISO
 * dates, applied to createdAt). Newest first.
 */
export const listActivityLog = async (req, res) => {
    try {
        const { actorId, role, action, from, to } = req.query;

        const page = parsePositiveInt(req.query.page, 1);
        const rawLimit = parsePositiveInt(req.query.limit, DEFAULT_LIMIT);
        if (page == null || rawLimit == null) {
            return res.status(400).json({ message: "page and limit must be positive integers" });
        }
        const limit = Math.min(rawLimit, MAX_LIMIT);

        const query = {};
        if (actorId) query.actorId = actorId;
        if (role != null && role !== "") {
            if (!LOGGED_ROLES.includes(role)) {
                return res.status(400).json({ message: `role must be one of: ${LOGGED_ROLES.join(", ")}` });
            }
            query.actorRole = role;
        }
        if (action != null && action !== "") {
            if (!ACTIVITY_ACTIONS.includes(action)) {
                return res.status(400).json({ message: "Unknown action value" });
            }
            query.action = action;
        }
        if (from || to) {
            query.createdAt = {};
            if (from) {
                const fromDate = new Date(from);
                if (Number.isNaN(fromDate.getTime())) {
                    return res.status(400).json({ message: "Invalid 'from' date" });
                }
                query.createdAt.$gte = fromDate;
            }
            if (to) {
                const toDate = new Date(to);
                if (Number.isNaN(toDate.getTime())) {
                    return res.status(400).json({ message: "Invalid 'to' date" });
                }
                // Date-only "to" values should include the whole day.
                if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
                    toDate.setUTCHours(23, 59, 59, 999);
                }
                query.createdAt.$lte = toDate;
            }
        }

        const total = await ActivityLog.countDocuments(query);
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const entries = await ActivityLog.find(query)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();

        res.status(200).json({
            entries: entries.map((e) => ({
                id: e._id,
                actorId: e.actorId,
                actorRole: e.actorRole,
                actorName: e.actorName,
                action: e.action,
                targetType: e.targetType,
                targetId: e.targetId,
                targetLabel: e.targetLabel,
                detail: e.detail,
                createdAt: e.createdAt,
            })),
            page,
            totalPages,
            total,
        });
    } catch (error) {
        console.error("Error listing activity log:", error);
        res.status(500).json({ message: error.message || "Internal server error" });
    }
};
