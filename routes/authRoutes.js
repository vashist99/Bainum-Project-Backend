import express from "express";
import { register, login, registerParent, registerTeacher, forgotPassword, resetPassword } from "../controllers/authController.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/register-parent", registerParent);
router.post("/register-teacher", registerTeacher);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

export default router;