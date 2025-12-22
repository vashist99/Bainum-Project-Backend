import express from "express";
import { createChild, getAllChildren, getChildById } from "../controllers/childController.js";

const router = express.Router();

router.post("/", createChild);
router.get("/", getAllChildren);
router.get("/:id", getChildById);

export default router;

