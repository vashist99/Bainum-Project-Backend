import express from "express";
import authenticateToken from "../middleware/authMiddleware.js";
import { requireCapability } from "../lib/permissions.js";
import {
    getHomeAccessState,
    grantHomeAccess,
    revokeHomeAccess,
    requestHomeAccess,
    setHomeTranscriptAccess,
} from "../controllers/homeAccessController.js";

const router = express.Router();

router.get("/child/:childId", authenticateToken, getHomeAccessState);
router.post("/child/:childId/grant", authenticateToken, grantHomeAccess);
router.post("/child/:childId/revoke", authenticateToken, revokeHomeAccess);
router.post("/child/:childId/request", authenticateToken, requestHomeAccess);
// Transcript tier is admin-gated: parents grant visualizations only.
router.post(
    "/child/:childId/transcript-access",
    authenticateToken,
    requireCapability("grantHomeTranscriptAccess"),
    setHomeTranscriptAccess
);

export default router;
