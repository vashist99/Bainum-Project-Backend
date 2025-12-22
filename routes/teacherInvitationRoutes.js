import express from 'express';
import { sendTeacherInvitation, verifyTeacherInvitation, getTeacherInvitations } from '../controllers/teacherInvitationController.js';
import authenticateToken from '../middleware/authMiddleware.js';

const router = express.Router();

// Send teacher invitation (admin only)
router.post('/send', authenticateToken, sendTeacherInvitation);

// Verify teacher invitation token (public endpoint)
router.get('/verify/:token', verifyTeacherInvitation);

// Get all teacher invitations (admin only)
router.get('/list', authenticateToken, getTeacherInvitations);

export default router;

