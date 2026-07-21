import express from 'express';
import authenticateToken from '../middleware/authMiddleware.js';
import { requireCapability, requireRole } from '../lib/permissions.js';
import {
    listCoaches,
    assignTeacherToCoach,
    unassignTeacherFromCoach,
    getCoachOverview,
    requestClassroomAccess,
    approveGrant,
    denyGrant,
    revokeGrant,
    setTranscriptAccess,
    pendingGrantsForTeacher,
} from '../controllers/coachController.js';

const router = express.Router();

// Admin coach management
router.get('/', authenticateToken, requireCapability('manageCoaches'), listCoaches);
router.post('/:coachId/teachers/:teacherId', authenticateToken, requireCapability('manageCoaches'), assignTeacherToCoach);
router.delete('/:coachId/teachers/:teacherId', authenticateToken, requireCapability('manageCoaches'), unassignTeacherFromCoach);

// Coach dashboard
router.get('/me/overview', authenticateToken, requireRole('coach'), getCoachOverview);

// Grant lifecycle
router.post('/grants/request', authenticateToken, requireCapability('requestCoachClassroomAccess'), requestClassroomAccess);
router.get('/grants/pending-for-teacher', authenticateToken, requireRole('teacher'), pendingGrantsForTeacher);
router.patch('/grants/:grantId/approve', authenticateToken, requireCapability('approveCoachAggregateAccess'), approveGrant);
router.patch('/grants/:grantId/deny', authenticateToken, requireCapability('approveCoachAggregateAccess'), denyGrant);
router.patch('/grants/:grantId/revoke', authenticateToken, requireCapability('approveCoachAggregateAccess'), revokeGrant);
router.patch('/grants/:grantId/transcript-access', authenticateToken, requireCapability('grantCoachTranscriptAccess'), setTranscriptAccess);

export default router;
