import express from "express";
import authenticateToken from "../middleware/authMiddleware.js";
import {
    getClassroomViewers,
    getHomeViewers,
    setClassroomChartStatus,
    setHomeChartStatus,
} from "../controllers/viewerAccessController.js";

const router = express.Router();

router.get("/classroom/:classroomId", authenticateToken, getClassroomViewers);
router.post("/classroom/:classroomId", authenticateToken, setClassroomChartStatus);
router.get("/home/:childId", authenticateToken, getHomeViewers);
router.post("/home/:childId", authenticateToken, setHomeChartStatus);

export default router;
