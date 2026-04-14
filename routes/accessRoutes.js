import express from "express";
import authenticateToken from "../middleware/authMiddleware.js";
import {
    requestTeacherAccessFromParent,
    approveParentAccessRequest,
    listPendingForTeacher,
    checkAccess,
} from "../controllers/accessController.js";

const router = express.Router();

router.post("/request-teacher-view", authenticateToken, requestTeacherAccessFromParent);
router.patch("/grants/:grantId/approve", authenticateToken, approveParentAccessRequest);
router.get("/pending-for-teacher", authenticateToken, listPendingForTeacher);
router.get("/check", authenticateToken, checkAccess);

export default router;
