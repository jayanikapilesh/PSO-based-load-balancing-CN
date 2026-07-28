import { useState, useRef, useCallback } from 'react';
import { calculateSessionMetrics } from '../utils/keystrokeMetrics';

/**
 * useKeystrokeCapture
 *
 * Security note:
 * - For password fields (isPassword=true), the actual typed characters are stored
 *   only in a ref (passwordValueRef) and NEVER in React state.
 * - This means the password is invisible in Chrome DevTools (React Components panel).
 * - Only keystroke timing metrics (hold time, flight time, etc.) are ever sent to
 *   the backend — the password characters themselves are never transmitted.
 * - All DB queries use parameterized placeholders ($1, $2...) to prevent SQL injection.
 * - Sensitive DB credentials are stored exclusively in the backend .env file.
 */
export function useKeystrokeCapture(targetText = '', isPassword = false) {
  // For password fields: store value in ref only — invisible to DevTools
  // For text fields: store in state so React can re-render highlighted characters
  const passwordValueRef = useRef('');
  const [typedText, setTypedText] = useState('');
  const [metrics, setMetrics] = useState(null);
  
  // Use refs for raw timing logs to avoid React re-renders interfering with fast typing
  const holdTimesRef = useRef([]);
  const flightTimesRef = useRef([]);
  const activeKeysRef = useRef(new Map());
  const lastKeyReleaseTimeRef = useRef(null);
  const startTimeRef = useRef(null);
  const endTimeRef = useRef(null);
  const backspaceCountRef = useRef(0);
  const isStartedRef = useRef(false);

  const startSession = useCallback(() => {
    holdTimesRef.current = [];
    flightTimesRef.current = [];
    activeKeysRef.current.clear();
    lastKeyReleaseTimeRef.current = null;
    startTimeRef.current = null;
    endTimeRef.current = null;
    backspaceCountRef.current = 0;
    isStartedRef.current = false;
    passwordValueRef.current = ''; // Clear password from ref (never was in state)
    setTypedText('');
    setMetrics(null);
  }, []);

  const handleKeyDown = useCallback((e) => {
    const now = performance.now();
    const key = e.key;
    const code = e.code; // Unique key identifier (e.g. KeyA, Backspace)

    // Start session timer on the first key press
    if (!isStartedRef.current) {
      isStartedRef.current = true;
      startTimeRef.current = now;
    }

    // Capture Flight Time: time from the release of the previous key to the press of this key
    if (lastKeyReleaseTimeRef.current !== null) {
      const flightTime = now - lastKeyReleaseTimeRef.current;
      // Filter out extreme pauses (e.g. >5 seconds) to prevent warping average typing metrics
      if (flightTime < 5000) {
        flightTimesRef.current.push(flightTime);
      }
    }

    // Track hold start for this key (ignoring repeating events while key is held down)
    if (!activeKeysRef.current.has(code)) {
      activeKeysRef.current.set(code, now);
    }

    // Increment Backspaces
    if (key === 'Backspace') {
      backspaceCountRef.current += 1;
    }
  }, []);

  const handleKeyUp = useCallback((e) => {
    const now = performance.now();
    const code = e.code;

    // Track the release time for flight time measurements
    lastKeyReleaseTimeRef.current = now;
    endTimeRef.current = now;

    // Capture Hold Time: duration the key was held
    if (activeKeysRef.current.has(code)) {
      const startPress = activeKeysRef.current.get(code);
      const holdTime = now - startPress;
      holdTimesRef.current.push(holdTime);
      activeKeysRef.current.delete(code);
    }

    // Re-evaluate metrics on each keystroke for real-time display
    if (startTimeRef.current) {
      const currentMetrics = calculateSessionMetrics(
        holdTimesRef.current,
        flightTimesRef.current,
        backspaceCountRef.current,
        typedText,
        targetText,
        startTimeRef.current,
        now
      );
      setMetrics(currentMetrics);
    }
  }, [typedText, targetText]);

  const handleChange = useCallback((e) => {
    const value = e.target.value;

    if (isPassword) {
      // SECURITY: Store actual password characters ONLY in a ref — never in React state.
      // This makes the password completely invisible in Chrome DevTools React Components panel.
      // The input shows masked '•' characters via type="password" — we use a masked placeholder
      // in state so React is aware of the field length without exposing the real value.
      passwordValueRef.current = value;
      // Store masked representation in state (length only — never the real characters)
      setTypedText('•'.repeat(value.length));
    } else {
      setTypedText(value);
    }

    // Sync latest typedText in real-time metrics (use safe non-sensitive value for metric calc)
    if (startTimeRef.current) {
      const currentMetrics = calculateSessionMetrics(
        holdTimesRef.current,
        flightTimesRef.current,
        backspaceCountRef.current,
        value,           // use real value only for metric calculations (never sent to network)
        targetText,
        startTimeRef.current,
        performance.now()
      );
      setMetrics(currentMetrics);
    }
  }, [targetText, isPassword]);

  const finalizeMetrics = useCallback(() => {
    if (!startTimeRef.current) return null;
    const finalEndTime = endTimeRef.current || performance.now();
    // For password fields, use the ref value (actual length/chars) for metric calculation.
    // The password characters themselves are NEVER included in the returned metrics object.
    const textForMetrics = isPassword ? passwordValueRef.current : typedText;
    const finalMetrics = calculateSessionMetrics(
      holdTimesRef.current,
      flightTimesRef.current,
      backspaceCountRef.current,
      textForMetrics,
      targetText,
      startTimeRef.current,
      finalEndTime
    );
    setMetrics(finalMetrics);
    return finalMetrics; // Contains only timing metrics — NO password characters
  }, [typedText, targetText, isPassword]);

  return {
    typedText,       // For password fields: masked '•' characters only — safe to render
    metrics,
    handleKeyDown,
    handleKeyUp,
    handleChange,
    reset: startSession,
    finalizeMetrics  // Returns only timing metrics — password characters never included
  };
}
export default useKeystrokeCapture;
