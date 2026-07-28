import * as db from '../models/behavior.model.js';
import { calculateBehaviorScore } from '../services/behavior.service.js';

/**
 * POST /api/behavior-analysis
 * Analyzes a typing session and either registers or verifies a user's biometric profile.
 * Also saves the session to history with ALL 6 metrics (including backspaceCount,
 * errorCount, typingDuration — as requested).
 */
export async function analyzeBehavior(req, res) {
  try {
    const { userId, sessionFeatures, register = false } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (!sessionFeatures) {
      return res.status(400).json({ error: 'sessionFeatures is required' });
    }

    const {
      averageHoldTime,
      averageFlightTime,
      typingSpeed,
      backspaceCount,
      errorCount,
      typingDuration,
    } = sessionFeatures;

    // Validate all 6 required metrics exist and are numbers
    const requiredMetrics = [
      'averageHoldTime',
      'averageFlightTime',
      'typingSpeed',
      'backspaceCount',   // ← all 6 validated
      'errorCount',        // ← all 6 validated
      'typingDuration',    // ← all 6 validated
    ];

    for (const metric of requiredMetrics) {
      if (sessionFeatures[metric] === undefined || typeof sessionFeatures[metric] !== 'number') {
        return res.status(400).json({ error: `sessionFeatures.${metric} must be a number` });
      }
    }

    // Retrieve existing user profile
    let profile = await db.getProfile(userId);

    // Registration flow
    if (register || !profile) {
      const savedProfile = await db.saveProfile(userId, {
        averageHoldTime,
        averageFlightTime,
        typingSpeed,
        backspaceCount,
        errorCount,
        typingDuration,
      });

      // Save this session to history with sessionType = 'register'
      await db.saveSession(userId, {
        averageHoldTime,
        averageFlightTime,
        typingSpeed,
        backspaceCount,
        errorCount,
        typingDuration,
      }, 'register');

      // Fetch updated sessions list to return in response
      const sessions = await db.getSessions(userId);

      return res.status(200).json({
        behaviorScore: 100,
        status: 'MATCH',
        registered: true,
        message: profile ? 'Behavioral profile updated.' : 'Behavioral profile registered.',
        profile: savedProfile,
        sessions,           // ← full sessions history returned
        dbType: db.isUsingFallback() ? 'JSON Fallback' : 'PostgreSQL',
      });
    }

    // Authentication flow — compare session against stored profile
    const result = calculateBehaviorScore(sessionFeatures, profile);

    // Save this authentication attempt to session history with sessionType = 'verify'
    await db.saveSession(userId, {
      averageHoldTime,
      averageFlightTime,
      typingSpeed,
      backspaceCount,
      errorCount,
      typingDuration,
    }, 'verify');

    // Fetch updated sessions list
    const sessions = await db.getSessions(userId);

    return res.status(200).json({
      behaviorScore: result.behaviorScore,
      status: result.status,
      similarities: result.similarities,
      profile,
      sessions,           // ← full sessions history returned
      dbType: db.isUsingFallback() ? 'JSON Fallback' : 'PostgreSQL',
    });
  } catch (err) {
    console.error('Error in analyzeBehavior controller:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

/**
 * GET /api/profile/:userId
 * Returns the user's aggregate profile + their full session history.
 */
export async function getUserProfile(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const profile = await db.getProfile(userId);
    if (!profile) {
      return res.status(404).json({ error: `No profile found for user ${userId}` });
    }

    // Also return session history with the profile
    const sessions = await db.getSessions(userId);

    return res.status(200).json({
      profile,
      sessions,           // ← sessions array with all 6 metrics each
      dbType: db.isUsingFallback() ? 'JSON Fallback' : 'PostgreSQL',
    });
  } catch (err) {
    console.error('Error in getUserProfile controller:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * DELETE /api/profile/:userId
 * Deletes a user's profile and all their session history (cascade).
 */
export async function deleteUserProfile(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const success = await db.deleteProfile(userId);
    if (!success) {
      return res.status(404).json({ error: `Profile not found or could not delete for user ${userId}` });
    }

    return res.status(200).json({ message: `Profile and all sessions for user "${userId}" deleted successfully` });
  } catch (err) {
    console.error('Error in deleteUserProfile controller:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * GET /api/sessions/:userId
 * Returns only the session history for a user (last 20 sessions, all 6 metrics each).
 */
export async function getUserSessions(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const sessions = await db.getSessions(userId);
    return res.status(200).json({ userId, sessions });
  } catch (err) {
    console.error('Error in getUserSessions controller:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
