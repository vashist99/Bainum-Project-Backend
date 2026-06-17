import express from "express";
import authenticateToken from "../middleware/authMiddleware.js";
import {
    createNote,
    getNotesByChild,
    getNotesByClassroom,
    deleteNote,
    updateNote,
} from "../controllers/noteController.js";

const router = express.Router();

router.use(authenticateToken);

router.post("/", createNote);
router.get("/child/:childId", getNotesByChild);
router.get("/classroom/:classroomId", getNotesByClassroom);
router.delete("/:noteId", deleteNote);
router.put("/:noteId", updateNote);

export default router;
