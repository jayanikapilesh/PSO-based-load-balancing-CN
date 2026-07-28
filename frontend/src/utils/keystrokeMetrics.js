/**
 * Calculates the Levenshtein distance (edit distance) between two strings.
 * This represents the number of character insertions, deletions, or substitutions
 * needed to transform the typed text into the target text.
 */
export function calculateLevenshteinDistance(a, b) {
  const tmp = [];
  let i, j;
  for (i = 0; i <= a.length; i++) {
    tmp.push([i]);
  }
  for (j = 1; j <= b.length; j++) {
    tmp[0].push(j);
  }
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1,
        tmp[i][j - 1] + 1,
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return tmp[a.length][b.length];
}

/**
 * Computes keystroke metrics from collected timing logs.
 * @param {Array} holdTimes - List of key hold durations (ms)
 * @param {Array} flightTimes - List of intervals between key presses (ms)
 * @param {number} backspaceCount - Number of backspaces pressed
 * @param {string} typedText - Final text typed by the user
 * @param {string} targetText - The target sentence to match
 * @param {number} startTime - Start timestamp (performance.now())
 * @param {number} endTime - End timestamp (performance.now())
 */
export function calculateSessionMetrics(holdTimes, flightTimes, backspaceCount, typedText, targetText = '', startTime = 0, endTime = 0) {
  const durationMs = endTime - startTime;
  const durationSec = durationMs > 0 ? durationMs / 1000 : 0;

  // Hold Time average
  const averageHoldTime = holdTimes.length > 0 
    ? Math.round(holdTimes.reduce((sum, t) => sum + t, 0) / holdTimes.length) 
    : 0;

  // Flight Time average
  const averageFlightTime = flightTimes.length > 0 
    ? Math.round(flightTimes.reduce((sum, t) => sum + t, 0) / flightTimes.length) 
    : 0;

  // Character count
  const totalCharactersTyped = typedText.length;

  // Typing Speed (WPM)
  // WPM = (chars / 5) / (duration in minutes)
  const durationMin = durationSec / 60;
  const typingSpeed = durationMin > 0 && totalCharactersTyped > 0
    ? Math.round((totalCharactersTyped / 5) / durationMin)
    : 0;

  // Error count using Levenshtein distance
  const errorCount = targetText 
    ? calculateLevenshteinDistance(typedText, targetText) 
    : 0;

  return {
    averageHoldTime,
    averageFlightTime,
    typingSpeed,
    backspaceCount,
    errorCount,
    typingDuration: Math.round(durationSec * 10) / 10, // round to 1 decimal place
    totalCharactersTyped,
    correctionsCount: backspaceCount // corrections count maps to backspaces/corrections
  };
}
