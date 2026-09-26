import express from 'express';
import authenticateToken from '../middleware/authMiddleware.js';
import { requireCapability, requireRole } from '../lib/permissions.js';
import {
    listCoaches,
    assignTeacherToCoach,
    unassignTeacherFromCoach,
    getCoachOverview,
    getCoachPerformance,
    revokeGrant,
    setTranscriptAccess,
} from '../controllers/coachController.js';
import { goneRequestFlow } from '../controllers/viewerAccessController.js';

const router = express.Router();

// Admin coach management
router.get('/', authenticateToken, requireCapability('manageCoaches'), listCoaches);
router.post('/:coachId/teachers/:teacherId', authenticateToken, requireCapability('manageCoaches'), assignTeacherToCoach);
router.delete('/:coachId/teachers/:teacherId', authenticateToken, requireCapability('manageCoaches'), unassignTeacherFromCoach);

// Coach dashboard
router.get('/me/overview', authenticateToken, requireRole('coach'), getCoachOverview);
router.get('/:coachId/performance', authenticateToken, getCoachPerformance);

// Grant lifecycle
router.post('/grants/request', authenticateToken, goneRequestFlow);
router.get('/grants/pending-for-teacher', authenticateToken, goneRequestFlow);
router.patch('/grants/:grantId/approve', authenticateToken, goneRequestFlow);
router.patch('/grants/:grantId/deny', authenticateToken, goneRequestFlow);
router.patch('/grants/:grantId/revoke', authenticateToken, requireCapability('approveCoachAggregateAccess'), revokeGrant);
router.patch('/grants/:grantId/transcript-access', authenticateToken, requireCapability('grantCoachTranscriptAccess'), setTranscriptAccess);

export default router;
