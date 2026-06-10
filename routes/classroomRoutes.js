import express from "express";
import authenticateToken from "../middleware/authMiddleware.js";
import {
    createClassroom,
    listClassrooms,
    getClassroom,
    getEligibleParents,
    inviteParents,
    getClassroomAssessments,
} from "../controllers/classroomController.js";

const router = express.Router();

// All classroom administration requires authentication; role-based access
// (admin / lead / assistant — parents always 403) is enforced in the
// controller via canManageClassroom.
router.post("/", authenticateToken, createClassroom);
router.get("/", authenticateToken, listClassrooms);
router.get("/:id", authenticateToken, getClassroom);
router.get("/:id/eligible-parents", authenticateToken, getEligibleParents);
router.post("/:id/invite", authenticateToken, inviteParents);
router.get("/:id/assessments", authenticateToken, getClassroomAssessments);

export default router;
