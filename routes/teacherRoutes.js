import express from "express";
import { createTeacher, getAllTeachers, getTeacherById, deleteTeacher } from "../controllers/teacherController.js";

const router = express.Router();

router.post("/", createTeacher);
router.get("/", getAllTeachers);
router.delete("/:id", deleteTeacher);
router.get("/:id", getTeacherById);

export default router;

