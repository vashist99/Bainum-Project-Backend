import express from "express";
import { createTeacher, getAllTeachers, getTeacherById, updateTeacher, deleteTeacher } from "../controllers/teacherController.js";
import authenticateToken from "../middleware/authMiddleware.js";
import { requireCapability } from "../lib/permissions.js";

const router = express.Router();

router.post("/", authenticateToken, requireCapability("manageTeachers"), createTeacher);
router.get("/", authenticateToken, getAllTeachers);
router.get("/:id", authenticateToken, getTeacherById);
router.put("/:id", authenticateToken, requireCapability("manageTeachers"), updateTeacher);
router.delete("/:id", authenticateToken, requireCapability("manageTeachers"), deleteTeacher);

export default router;

