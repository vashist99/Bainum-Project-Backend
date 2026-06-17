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
    removeChildFromClassroom,
    getClassroomTranscripts,
} from "../controllers/classroomController.js";

const router = express.Router();

// All classroom routes require authentication. Role-based access is then
// enforced inside the controller:
//  - read paths (GET /:id, /:id/assessments, /:id/transcripts) allow
//    admin + lead/assistant teachers (full) AND enrolled parents
//    (scoped, read-only).
//  - write paths (invite, child-removal) require admin or a classroom
//    teacher; child-removal additionally requires admin or the lead
//    (assistant teachers cannot remove children).
//  - DELETE /:id (whole classroom) requires admin or the lead teacher.
router.post("/", authenticateToken, createClassroom);
router.get("/", authenticateToken, listClassrooms);
router.get("/:id", authenticateToken, getClassroom);
router.get("/:id/eligible-parents", authenticateToken, getEligibleParents);
router.post("/:id/invite", authenticateToken, inviteParents);
router.get("/:id/assessments", authenticateToken, getClassroomAssessments);
router.get("/:id/transcripts", authenticateToken, getClassroomTranscripts);
router.delete(
    "/:id/children/:childId",
    authenticateToken,
    removeChildFromClassroom
);
router.delete("/:id", authenticateToken, deleteClassroom);

export default router;
