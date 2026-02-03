import express from "express";
import { 
    createCenter, 
    getAllCenters, 
    getCenterById, 
    updateCenter, 
    deleteCenter,
    getTeachersByCenter 
} from "../controllers/centerController.js";
import authenticateToken from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", authenticateToken, createCenter);
router.get("/", authenticateToken, getAllCenters);
router.get("/:id", authenticateToken, getCenterById);
router.put("/:id", authenticateToken, updateCenter);
router.delete("/:id", authenticateToken, deleteCenter);
router.get("/:centerName/teachers", authenticateToken, getTeachersByCenter);

export default router;
