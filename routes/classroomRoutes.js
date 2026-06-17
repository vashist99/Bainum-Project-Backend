import express from "express";
import authenticateToken from "../middleware/authMiddleware.js";
import {
    createClassroom,
    listClassrooms,
    getClassroom,
    getEligibleParents,
    inviteParents,
    getClassroomAssessments,
    deleteClassroom,
    patchClassroomChildren,
    getClassroomTranscripts,
} from "../controllers/classroomController.js";

const router = express.Router();

// All classroom administration requires authentication; role-based access
// (admin / lead / assistant — parents always 403) is enforced in the
// controller via canManageClassroom (read/admin paths) or the per-route
// role check (delete = admin or lead only; admin-manual-enrollment =
// admin only).
router.post("/", authenticateToken, createClassroom);
router.get("/", authenticateToken, listClassrooms);
router.get("/:id", authenticateToken, getClassroom);
router.get("/:id/eligible-parents", authenticateToken, getEligibleParents);
router.post("/:id/invite", authenticateToken, inviteParents);
router.get("/:id/assessments", authenticateToken, getClassroomAssessments);
router.get("/:id/transcripts", authenticateToken, getClassroomTranscripts);
router.patch("/:id/children", authenticateToken, patchClassroomChildren);
router.delete("/:id", authenticateToken, deleteClassroom);

export default router;
