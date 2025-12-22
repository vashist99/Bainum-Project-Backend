import express from 'express';
import { sendInvitation, verifyInvitation, getInvitations } from '../controllers/invitationController.js';
import authenticateToken from '../middleware/authMiddleware.js';
const router = express.Router();

// Send invitation (admin/teacher only)
router.post('/send', authenticateToken, sendInvitation);

// Verify invitation token (public endpoint)
router.get('/verify/:token', authenticateToken, verifyInvitation);

// Get all invitations (admin/teacher only)
router.get('/list', authenticateToken, getInvitations);

export default router;

