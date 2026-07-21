import express from 'express';
import { sendCoachInvitation, verifyCoachInvitation, getCoachInvitations } from '../controllers/coachInvitationController.js';
import authenticateToken from '../middleware/authMiddleware.js';
import { requireCapability } from '../lib/permissions.js';

const router = express.Router();

// Send coach invitation (admin only)
router.post('/send', authenticateToken, requireCapability('inviteCoaches'), sendCoachInvitation);

// Verify coach invitation token (public endpoint)
router.get('/verify/:token', verifyCoachInvitation);

// Get all coach invitations (admin only)
router.get('/list', authenticateToken, requireCapability('inviteCoaches'), getCoachInvitations);

export default router;
