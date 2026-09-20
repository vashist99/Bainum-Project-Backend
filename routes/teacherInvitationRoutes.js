import express from 'express';
import { sendTeacherInvitation, verifyTeacherInvitation, getTeacherInvitations } from '../controllers/teacherInvitationController.js';
import authenticateToken from '../middleware/authMiddleware.js';
import { requireCapability } from '../lib/permissions.js';

const router = express.Router();

router.post('/send', authenticateToken, requireCapability('inviteTeachers'), sendTeacherInvitation);

// Verify teacher invitation token (public endpoint)
router.get('/verify/:token', verifyTeacherInvitation);

router.get('/list', authenticateToken, requireCapability('inviteTeachers'), getTeacherInvitations);

export default router;

