/**
 * Calculates similarity between two numeric values.
 * Returns a score between 0 and 1.
 */
function calculateFeatureSimilarity(sessionVal, profileVal, isCount = false) {
  if (profileVal === undefined || profileVal === null) return 0;
  
  if (isCount) {
    // For count features (backspaces, errors) which can easily be 0
    if (sessionVal === 0 && profileVal === 0) return 1.0;
    const maxVal = Math.max(profileVal, 1.0);
    const diff = Math.abs(sessionVal - profileVal);
    return Math.max(0, 1 - (diff / maxVal));
  } else {
    // For timing/speed features
    if (profileVal === 0) {
      return sessionVal === 0 ? 1.0 : 0.0;
    }
    const diff = Math.abs(sessionVal - profileVal);
    return Math.max(0, 1 - (diff / profileVal));
  }
}

/**
 * Compares session features to a stored profile.
 * Returns a score from 0 to 100, and a match status (MATCH or MISMATCH).
 */
export function calculateBehaviorScore(sessionFeatures, profile) {
  // Weights (must sum to 1.0)
  const weights = {
    averageHoldTime: 0.25,
    averageFlightTime: 0.25,
    typingSpeed: 0.20,
    typingDuration: 0.15,
    backspaceCount: 0.075,
    errorCount: 0.075,
  };

  // Calculate component similarities
  const similarities = {
    averageHoldTime: calculateFeatureSimilarity(
      sessionFeatures.averageHoldTime,
      profile.averageHoldTime,
      false
    ),
    averageFlightTime: calculateFeatureSimilarity(
      sessionFeatures.averageFlightTime,
      profile.averageFlightTime,
      false
    ),
    typingSpeed: calculateFeatureSimilarity(
      sessionFeatures.typingSpeed,
      profile.typingSpeed,
      false
    ),
    typingDuration: calculateFeatureSimilarity(
      sessionFeatures.typingDuration,
      profile.typingDuration,
      false
    ),
    backspaceCount: calculateFeatureSimilarity(
      sessionFeatures.backspaceCount,
      profile.backspaceCount,
      true
    ),
    errorCount: calculateFeatureSimilarity(
      sessionFeatures.errorCount,
      profile.errorCount,
      true
    ),
  };

  // Sum weighted scores
  let totalScore = 0;
  for (const key in weights) {
    totalScore += similarities[key] * weights[key];
  }

  // Convert to 0 - 100 integer
  const behaviorScore = Math.min(100, Math.max(0, Math.round(totalScore * 100)));
  
  // Decide match status (threshold = 80)
  const threshold = 80;
  const status = behaviorScore >= threshold ? 'MATCH' : 'MISMATCH';

  return {
    behaviorScore,
    status,
    similarities, // Expose breakdown for rich UI feedback
  };
}
