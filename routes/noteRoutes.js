import express from "express";
import { createNote, getNotesByChild, deleteNote, updateNote } from "../controllers/noteController.js";

const router = express.Router();

router.post("/", createNote);
router.get("/child/:childId", getNotesByChild);
router.delete("/:noteId", deleteNote);
router.put("/:noteId", updateNote);

export default router;

