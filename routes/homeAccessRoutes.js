import express from "express";
import authenticateToken from "../middleware/authMiddleware.js";
import {
    getHomeAccessState,
    grantHomeAccess,
    revokeHomeAccess,
    requestHomeAccess,
} from "../controllers/homeAccessController.js";

const router = express.Router();

router.get("/child/:childId", authenticateToken, getHomeAccessState);
router.post("/child/:childId/grant", authenticateToken, grantHomeAccess);
router.post("/child/:childId/revoke", authenticateToken, revokeHomeAccess);
router.post("/child/:childId/request", authenticateToken, requestHomeAccess);

export default router;
