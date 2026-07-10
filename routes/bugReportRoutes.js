import express from "express";
import authenticateToken from "../middleware/authMiddleware.js";
import { submitBugReport } from "../controllers/bugReportController.js";

const router = express.Router();

router.post("/", authenticateToken, submitBugReport);

export default router;
