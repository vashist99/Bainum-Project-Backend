import express from "express";
import authenticateToken from "../middleware/authMiddleware.js";
import {
    listNotifications,
    dismissNotification,
} from "../controllers/notificationController.js";

const router = express.Router();

router.get("/", authenticateToken, listNotifications);
router.delete("/:id", authenticateToken, dismissNotification);

export default router;
