import express from "express";
import { register, login, registerParent, registerTeacher, registerCoach, forgotPassword, resetPassword, deleteOwnAccount } from "../controllers/authController.js";
import authenticateToken from "../middleware/authMiddleware.js";
import { requireCapability } from "../lib/permissions.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/register-parent", registerParent);
router.post("/register-teacher", registerTeacher);
router.post("/register-coach", registerCoach);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
// Self-service account deletion — teachers and coaches only.
router.delete("/me", authenticateToken, requireCapability("deleteOwnAccount"), deleteOwnAccount);

export default router;
