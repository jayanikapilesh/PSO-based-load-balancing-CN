import React, { useState, useEffect } from 'react';
import useKeystrokeCapture from '../hooks/useKeystrokeCapture';
import TypingArea from '../components/TypingArea';
import * as api from '../services/behaviorApi';

export function BehaviorAuthentication() {
  const TARGET_SENTENCE = "The quick brown fox jumps over the lazy dog";
  
  const [userId, setUserId] = useState('demo-user');
  const [profile, setProfile] = useState(null);
  const [dbType, setDbType] = useState('');
  const [activeTab, setActiveTab] = useState('register'); // 'register' or 'authenticate'
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Results from authentication
  const [authResult, setAuthResult] = useState(null);
  const [submittedFeatures, setSubmittedFeatures] = useState(null);

  // Keystroke Capture Hooks
  // isPassword=true → actual chars stored only in ref, never in React state (invisible in DevTools)
  const regSentence = useKeystrokeCapture(TARGET_SENTENCE, false);
  const regPassword = useKeystrokeCapture("", true);  // password — secure
  const authSentence = useKeystrokeCapture(TARGET_SENTENCE, false);
  const authPassword = useKeystrokeCapture("", true); // password — secure

  // Check if profile exists on user ID change
  const checkProfileStatus = async (targetId = userId) => {
    if (!targetId.trim()) return;
    setError('');
    setIsLoading(true);
    try {
      const res = await api.getUserProfile(targetId);
      if (res && res.profile) {
        setProfile(res.profile);
        setDbType(res.dbType || 'PostgreSQL');
      } else {
        setProfile(null);
        setDbType('');
      }
    } catch (err) {
      console.error(err);
      setProfile(null);
      setDbType('');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkProfileStatus();
  }, [userId]);

  const handleRegisterProfile = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    
    // Finalize metrics
    const sentenceMetrics = regSentence.finalizeMetrics();
    const passwordMetrics = regPassword.finalizeMetrics();

    if (!sentenceMetrics) {
      setError('Please type the fixed sentence before registering.');
      return;
    }

    setIsLoading(true);
    try {
      // For POC, we combine sentence metrics with password metrics if typed, or just use sentence metrics.
      // We will save the sentence metrics as primary profile behavior.
      const featuresToSubmit = { ...sentenceMetrics };
      
      // If password was also typed, blend hold times and flight times to represent overall typing biometrics
      if (passwordMetrics && passwordMetrics.totalCharactersTyped > 0) {
        const totalChars = sentenceMetrics.totalCharactersTyped + passwordMetrics.totalCharactersTyped;
        featuresToSubmit.averageHoldTime = Math.round(
          (sentenceMetrics.averageHoldTime * sentenceMetrics.totalCharactersTyped +
            passwordMetrics.averageHoldTime * passwordMetrics.totalCharactersTyped) / totalChars
        );
        featuresToSubmit.averageFlightTime = Math.round(
          (sentenceMetrics.averageFlightTime * (sentenceMetrics.totalCharactersTyped - 1) +
            passwordMetrics.averageFlightTime * (passwordMetrics.totalCharactersTyped - 1)) / 
            Math.max(1, totalChars - 2)
        );
        featuresToSubmit.typingSpeed = Math.round((sentenceMetrics.typingSpeed + passwordMetrics.typingSpeed) / 2);
        featuresToSubmit.backspaceCount += passwordMetrics.backspaceCount;
        featuresToSubmit.typingDuration = Math.round((sentenceMetrics.typingDuration + passwordMetrics.typingDuration) * 10) / 10;
        // Password errors are omitted since there's no fixed target
      }

      const res = await api.analyzeBehavior(userId, featuresToSubmit, true);
      setSuccess(res.message || 'Profile registered successfully!');
      setProfile(res.profile);
      
      // Clear inputs
      regSentence.reset();
      regPassword.reset();
      
      // Auto switch tab to testing
      setTimeout(() => {
        setActiveTab('authenticate');
        setSuccess('');
      }, 1500);
    } catch (err) {
      setError(err.message || 'Failed to register profile.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuthenticate = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setAuthResult(null);

    const sentenceMetrics = authSentence.finalizeMetrics();
    const passwordMetrics = authPassword.finalizeMetrics();

    if (!sentenceMetrics) {
      setError('Please type the fixed sentence to authenticate.');
      return;
    }

    setIsLoading(true);
    try {
      const featuresToSubmit = { ...sentenceMetrics };

      // Blend password metrics if typed
      if (passwordMetrics && passwordMetrics.totalCharactersTyped > 0) {
        const totalChars = sentenceMetrics.totalCharactersTyped + passwordMetrics.totalCharactersTyped;
        featuresToSubmit.averageHoldTime = Math.round(
          (sentenceMetrics.averageHoldTime * sentenceMetrics.totalCharactersTyped +
            passwordMetrics.averageHoldTime * passwordMetrics.totalCharactersTyped) / totalChars
        );
        featuresToSubmit.averageFlightTime = Math.round(
          (sentenceMetrics.averageFlightTime * (sentenceMetrics.totalCharactersTyped - 1) +
            passwordMetrics.averageFlightTime * (passwordMetrics.totalCharactersTyped - 1)) / 
            Math.max(1, totalChars - 2)
        );
        featuresToSubmit.typingSpeed = Math.round((sentenceMetrics.typingSpeed + passwordMetrics.typingSpeed) / 2);
        featuresToSubmit.backspaceCount += passwordMetrics.backspaceCount;
        featuresToSubmit.typingDuration = Math.round((sentenceMetrics.typingDuration + passwordMetrics.typingDuration) * 10) / 10;
      }

      setSubmittedFeatures(featuresToSubmit);
      const res = await api.analyzeBehavior(userId, featuresToSubmit, false);
      setAuthResult(res);
      
      // Reset verification fields
      authSentence.reset();
      authPassword.reset();
    } catch (err) {
      setError(err.message || 'Failed to analyze behavior.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetProfile = async () => {
    if (!window.confirm(`Are you sure you want to delete the behavioral profile for user "${userId}"?`)) {
      return;
    }
    setError('');
    setSuccess('');
    setAuthResult(null);
    setIsLoading(true);
    try {
      await api.deleteUserProfile(userId);
      setSuccess('Biometric profile deleted successfully.');
      setProfile(null);
      setActiveTab('register');
    } catch (err) {
      setError(err.message || 'Failed to delete profile.');
    } finally {
      setIsLoading(false);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 90) return '#10b981'; // green
    if (score >= 80) return '#3b82f6'; // blue
    if (score >= 60) return '#f59e0b'; // orange
    return '#ef4444'; // red
  };

  return (
    <div className="biometrics-dashboard">
      <div className="glow-bubble bubble-1"></div>
      <div className="glow-bubble bubble-2"></div>
      
      <header className="dashboard-header">
        <h1 className="glowing-title">Behavioral Biometrics</h1>
        <p className="subtitle">Real-time Keystroke Dynamics & Biometric Profile Verification Engine</p>
      </header>

      {/* User Selection & Config */}
      <section className="dashboard-card user-config-card">
        <div className="user-input-group">
          <label htmlFor="userIdInput">Select User ID:</label>
          <input
            id="userIdInput"
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Enter unique User ID..."
            className="user-id-field"
          />
          <button 
            type="button" 
            className="btn btn-secondary refresh-btn"
            onClick={() => checkProfileStatus()}
            disabled={isLoading}
          >
            ↻ Reload
          </button>
        </div>

        <div className="profile-status-badge">
          {isLoading ? (
            <span className="status-loading">Checking Database...</span>
          ) : profile ? (
            <span className="status-registered">
              ✓ Registered Profile Found ({dbType})
              <button 
                type="button" 
                className="reset-profile-btn" 
                onClick={handleResetProfile}
                title="Delete this profile to start over"
              >
                Reset Profile
              </button>
            </span>
          ) : (
            <span className="status-unregistered">✗ No Behavioral Profile Registered</span>
          )}
        </div>
      </section>

      {/* Main Tabs */}
      <div className="tab-control-wrapper">
        <button
          className={`tab-btn ${activeTab === 'register' ? 'tab-active' : ''}`}
          onClick={() => setActiveTab('register')}
        >
          1. Profile Registration
        </button>
        <button
          className={`tab-btn ${activeTab === 'authenticate' ? 'tab-active' : ''}`}
          onClick={() => {
            if (!profile) {
              alert('Please register a behavioral profile first!');
              return;
            }
            setActiveTab('authenticate');
          }}
          disabled={!profile}
        >
          2. Authentication Test
        </button>
      </div>

      {error && <div className="alert-message alert-error">{error}</div>}
      {success && <div className="alert-message alert-success">{success}</div>}

      <div className="tab-content-container">
        {activeTab === 'register' ? (
          <form className="dashboard-card main-form" onSubmit={handleRegisterProfile}>
            <div className="section-instruction">
              <h3>Biometric Pattern Registration</h3>
              <p>
                First, type the fixed phrase below in your normal typing style. Optionally, enter a password/PIN in the field below to record your password-specific biometrics. Click <strong>Register Biometric Profile</strong> to store your pattern in the database.
              </p>
            </div>

            <TypingArea
              label="Fixed Phrase (Record Biometrics)"
              targetText={TARGET_SENTENCE}
              placeholder="Type the sentence above exactly..."
              captureHook={regSentence}
              disabled={isLoading}
            />

            <TypingArea
              label="Password / PIN (Optional: Capture Password Biometrics)"
              placeholder="Enter a secret password or pin to record key dynamics..."
              isPassword={true}
              captureHook={regPassword}
              disabled={isLoading}
            />

            <div className="form-action-bar">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  regSentence.reset();
                  regPassword.reset();
                }}
                disabled={isLoading}
              >
                Reset Inputs
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-glow"
                disabled={isLoading || !regSentence.typedText}
              >
                {profile ? 'Update Biometric Profile' : 'Register Biometric Profile'}
              </button>
            </div>
          </form>
        ) : (
          <form className="dashboard-card main-form" onSubmit={handleAuthenticate}>
            <div className="section-instruction">
              <h3>Biometric Pattern Authentication</h3>
              <p>
                Verify your identity by typing the same phrase and password pattern below. The system will compare your typing mechanics with your stored profile and output a match decision.
              </p>
            </div>

            <TypingArea
              label="Fixed Phrase (Verify Biometrics)"
              targetText={TARGET_SENTENCE}
              placeholder="Type the verification sentence..."
              captureHook={authSentence}
              disabled={isLoading}
            />

            <TypingArea
              label="Password / PIN (Verify Biometrics)"
              placeholder="Type your secret password..."
              isPassword={true}
              captureHook={authPassword}
              disabled={isLoading}
            />

            <div className="form-action-bar">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  authSentence.reset();
                  authPassword.reset();
                }}
                disabled={isLoading}
              >
                Reset Inputs
              </button>
              <button
                type="submit"
                className="btn btn-primary btn-glow-auth"
                disabled={isLoading || !authSentence.typedText}
              >
                Verify Typing Biometrics
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Telemetry & Results Analysis */}
      {authResult && (
        <section className="dashboard-card results-card fade-in">
          <div className="results-header">
            <h3>Verification Output</h3>
            <div className="match-status-indicator">
              <span className={`match-badge badge-${authResult.status.toLowerCase()}`}>
                {authResult.status}
              </span>
            </div>
          </div>

          <div className="score-container">
            <div 
              className="score-radial-progress"
              style={{
                background: `conic-gradient(${getScoreColor(authResult.behaviorScore)} ${authResult.behaviorScore * 3.6}deg, rgba(255, 255, 255, 0.05) 0deg)`
              }}
            >
              <div className="score-inner-val">
                <span className="score-num">{authResult.behaviorScore}</span>
                <span className="score-pct">%</span>
                <span className="score-lbl">Behavior Score</span>
              </div>
            </div>
            <div className="score-explanation">
              <h4>Telemetry Diagnostics</h4>
              <p>
                {authResult.status === 'MATCH' 
                  ? 'Access Granted. Keystroke flight times, key hold rates, and speed profiles closely align with historical records.' 
                  : 'Access Denied. Typing pattern variance exceeds safe verification thresholds. Potential impersonation detected.'}
              </p>
              <div className="threshold-gauge">
                <span>Min Match Threshold: 80%</span>
                <div className="threshold-bar-track">
                  <div className="threshold-marker" style={{ left: '80%' }}></div>
                  <div className="score-marker-bar" style={{ width: `${authResult.behaviorScore}%`, backgroundColor: getScoreColor(authResult.behaviorScore) }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Metric Breakdown Table */}
          <div className="metrics-breakdown-wrapper">
            <h4>Biometric Similarity Breakdown</h4>
            <div className="table-responsive">
              <table className="metrics-table">
                <thead>
                  <tr>
                    <th>Biometric Metric</th>
                    <th>Profile Baseline</th>
                    <th>Session Reading</th>
                    <th>Component Similarity</th>
                    <th>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Average Key Hold Time</td>
                    <td>{Math.round(authResult.profile.averageHoldTime)} ms</td>
                    <td>{submittedFeatures ? Math.round(submittedFeatures.averageHoldTime) : '-'} ms</td>
                    <td>{Math.round(authResult.similarities.averageHoldTime * 100)}%</td>
                    <td>25%</td>
                  </tr>
                  <tr>
                    <td>Average Flight Time</td>
                    <td>{Math.round(authResult.profile.averageFlightTime)} ms</td>
                    <td>{submittedFeatures ? Math.round(submittedFeatures.averageFlightTime) : '-'} ms</td>
                    <td>{Math.round(authResult.similarities.averageFlightTime * 100)}%</td>
                    <td>25%</td>
                  </tr>
                  <tr>
                    <td>Typing Speed</td>
                    <td>{Math.round(authResult.profile.typingSpeed)} WPM</td>
                    <td>{submittedFeatures ? Math.round(submittedFeatures.typingSpeed) : '-'} WPM</td>
                    <td>{Math.round(authResult.similarities.typingSpeed * 100)}%</td>
                    <td>20%</td>
                  </tr>
                  <tr>
                    <td>Total Typing Duration</td>
                    <td>{authResult.profile.typingDuration} s</td>
                    <td>{submittedFeatures ? submittedFeatures.typingDuration : '-'} s</td>
                    <td>{Math.round(authResult.similarities.typingDuration * 100)}%</td>
                    <td>15%</td>
                  </tr>
                  <tr>
                    <td>Number of Backspaces</td>
                    <td>{authResult.profile.backspaceCount}</td>
                    <td>{submittedFeatures ? submittedFeatures.backspaceCount : '-'}</td>
                    <td>{Math.round(authResult.similarities.backspaceCount * 100)}%</td>
                    <td>7.5%</td>
                  </tr>
                  <tr>
                    <td>Error Count (Edit Distance)</td>
                    <td>{authResult.profile.errorCount}</td>
                    <td>{submittedFeatures ? submittedFeatures.errorCount : '-'}</td>
                    <td>{Math.round(authResult.similarities.errorCount * 100)}%</td>
                    <td>7.5%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default BehaviorAuthentication;
