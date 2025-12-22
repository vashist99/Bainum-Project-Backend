import express from "express";
import { register, login, registerParent, registerTeacher } from "../controllers/authController.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/register-parent", registerParent);
router.post("/register-teacher", registerTeacher);

export default router;