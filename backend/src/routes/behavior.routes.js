import express from 'express';
import {
  analyzeBehavior,
  getUserProfile,
  deleteUserProfile,
  getUserSessions,
} from '../controllers/behavior.controller.js';

const router = express.Router();

router.post('/behavior-analysis', analyzeBehavior);
router.get('/profile/:userId', getUserProfile);
router.delete('/profile/:userId', deleteUserProfile);
router.get('/sessions/:userId', getUserSessions);   // ← new: fetch session history only

export default router;
