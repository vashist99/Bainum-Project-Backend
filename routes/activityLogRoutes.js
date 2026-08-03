import express from "express";
import authenticateToken from "../middleware/authMiddleware.js";
import { requireCapability } from "../lib/permissions.js";
import { listActivityLog } from "../controllers/activityLogController.js";
import { logActivity } from "../lib/activityLogService.js";

const router = express.Router();

// Admin-only teacher/coach activity log (Settings → Activities log).
router.get("/", authenticateToken, requireCapability("viewActivityLog"), listActivityLog);

// Transcript rejection is a client-side discard (no assessment is ever
// persisted), so the modals self-report it here. The service's role gate
// restricts rows to teachers/coaches; everyone else is a silent no-op.
router.post("/transcript-rejected", authenticateToken, async (req, res) => {
    const targetLabel = String(req.body?.targetLabel || "").slice(0, 200);
    await logActivity({
        actor: req.user,
        action: "transcript-rejected",
        targetType: "assessment",
        targetLabel,
        detail: "Rejected a transcript before saving",
    });
    res.status(204).end();
});

export default router;
