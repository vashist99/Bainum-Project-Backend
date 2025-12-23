import express from "express";
import { createChild, getAllChildren, getChildById } from "../controllers/childController.js";
import authenticateToken from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", authenticateToken, createChild);
router.get("/", authenticateToken, getAllChildren);
router.get("/:id", authenticateToken, getChildById);

export default router;

