import React, { useState, useEffect } from 'react';
import {
  adminLogin,
  getIntegrityStatus,
  getIntegrityReport,
  triggerIntegrityScan,
  getAuditLogs,
  recertifyComponent,
  updateConfig,
  injectFailure,
  restoreBaselines,
  testPrediction,
  testBiometric,
  getAdminToken,
  setAdminToken
} from '../services/adminApi';

export default function AdminIntegrityDashboard() {
  const [activeTab, setActiveTab] = useState('integrity'); // 'integrity' | 'audit' | 'config' | 'test' | 'biometric'
  const [statusData, setStatusData] = useState(null);
  const [reportData, setReportData] = useState(null);
  const [auditData, setAuditData] = useState([]);
  const [auditChainValid, setAuditChainValid] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  
  // Auth state
  const [adminUser, setAdminUser] = useState('admin');
  const [adminPass, setAdminPass] = useState('AdminPass2026!');
  const [isLoggedIn, setIsLoggedIn] = useState(!!getAdminToken());

  // Configuration Form state
  const [configType, setConfigType] = useState('thresholds');
  const [configJsonText, setConfigJsonText] = useState(JSON.stringify({
    lowRiskMaxAmount: 500.0,
    mediumRiskMaxAmount: 2500.0,
    highRiskMaxAmount: 10000.0,
    anomalyScoreThreshold: 0.75,
    velocityLimitPerMinute: 5
  }, null, 2));

  // Test simulation state
  const [testResult, setTestResult] = useState(null);

  // Load initial status & report data
  const refreshData = async () => {
    setLoading(true);
    try {
      const statusRes = await getIntegrityStatus();
      setStatusData(statusRes);

      const reportRes = await getIntegrityReport();
      setReportData(reportRes);

      if (isLoggedIn) {
        try {
          const auditRes = await getAuditLogs();
          setAuditData(auditRes.logs || []);
          setAuditChainValid(auditRes.auditChainValid);
        } catch (e) {
          console.warn('Audit fetch error:', e.message);
        }
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshData();
  }, [isLoggedIn]);

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await adminLogin(adminUser, adminPass);
      setIsLoggedIn(true);
      setIsAuthModalOpen(false);
      setMessage({ type: 'success', text: 'Authenticated successfully as Administrator.' });
      refreshData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleLogout = () => {
    setAdminToken('');
    setIsLoggedIn(false);
    setMessage({ type: 'info', text: 'Logged out of Administrative session.' });
  };

  const handleManualScan = async () => {
    setLoading(true);
    try {
      const res = await triggerIntegrityScan();
      setMessage({ type: 'success', text: 'SHA-256 System Integrity Verification scan completed.' });
      refreshData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRecertify = async (assetId) => {
    try {
      await recertifyComponent(assetId);
      setMessage({ type: 'success', text: `Recertified reference SHA-256 hash for asset: ${assetId}` });
      refreshData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleSaveConfig = async () => {
    try {
      const parsed = JSON.parse(configJsonText);
      await updateConfig(configType, parsed);
      setMessage({ type: 'success', text: `Successfully updated ${configType} configuration!` });
      refreshData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    }
  };

  const handleInjectFailure = async (target, type) => {
    setLoading(true);
    try {
      const res = await injectFailure(target, type);
      setMessage({ type: 'error', text: `ALERT: Simulated tamper/corruption injected on ${target}! Integrity check updated.` });
      refreshData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleRestoreBaselines = async () => {
    setLoading(true);
    try {
      await restoreBaselines();
      setMessage({ type: 'success', text: 'Restored pristine configuration files and SHA-256 baselines.' });
      refreshData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleTestPrediction = async () => {
    try {
      const res = await testPrediction(2500, 0.15);
      setTestResult(res);
    } catch (err) {
      setTestResult({ error: err.message });
    }
  };

  const handleTestBiometric = async (factor) => {
    try {
      const res = await testBiometric('user-demo-99', factor);
      setTestResult(res);
    } catch (err) {
      setTestResult({ error: err.message });
    }
  };

  const isHealthy = statusData?.overallStatus === 'HEALTHY';
  const isLocked = statusData?.isAdminLocked;

  return (
    <div style={styles.container}>
      {/* Top Banner & Header */}
      <header style={styles.header}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h1 style={styles.title}>Admin-Side System Integrity</h1>
            <span style={isHealthy ? styles.healthyBadge : styles.compromisedBadge}>
              {isHealthy ? '● SYSTEM INTEGRITY HEALTHY' : '▲ SYSTEM INTEGRITY COMPROMISED'}
            </span>
            {isLocked && (
              <span style={styles.lockedBadge}>🔒 ADMIN MODIFICATIONS LOCKED</span>
            )}
          </div>
          <p style={styles.subtitle}>
            Continuous SHA-256 Verification • Cryptographic Append-Only Audit Logging • JWT RBAC Enforcement
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button style={styles.scanBtn} onClick={handleManualScan} disabled={loading}>
            {loading ? 'Scanning...' : '⚡ Trigger SHA-256 Verification'}
          </button>
          
          {isLoggedIn ? (
            <button style={styles.logoutBtn} onClick={handleLogout}>
              Logout (Admin)
            </button>
          ) : (
            <button style={styles.loginBtn} onClick={() => setIsAuthModalOpen(true)}>
              🔐 Admin Login
            </button>
          )}
        </div>
      </header>

      {/* Alert Banner */}
      {message && (
        <div style={message.type === 'error' ? styles.errorMessage : styles.successMessage}>
          {message.text}
          <button style={styles.closeMsgBtn} onClick={() => setMessage(null)}>✕</button>
        </div>
      )}

      {!isHealthy && (
        <div style={styles.criticalAlertBanner}>
          <h3>⚠️ CRITICAL INTEGRITY ALERT: Component Tampering Detected!</h3>
          <p>
            One or more protected model files or configurations do not match their stored SHA-256 reference baselines.
            Administrative modifications have been locked to prevent compromised policy propagation.
          </p>
        </div>
      )}

      {/* Quick Summary Cards */}
      <div style={styles.statsRow}>
        <div style={styles.statCard}>
          <div style={styles.statLabel}>Overall Integrity Status</div>
          <div style={{ ...styles.statValue, color: isHealthy ? '#10B981' : '#EF4444' }}>
            {statusData?.overallStatus || 'UNKNOWN'}
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statLabel}>Protected Components</div>
          <div style={styles.statValue}>
            {reportData?.totalProtectedComponents || 9} Assets
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statLabel}>Active Compromise Alerts</div>
          <div style={{ ...styles.statValue, color: (statusData?.activeAlertsCount || 0) > 0 ? '#EF4444' : '#10B981' }}>
            {statusData?.activeAlertsCount || 0} Alerts
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statLabel}>Audit Chain Integrity</div>
          <div style={{ ...styles.statValue, color: auditChainValid ? '#10B981' : '#EF4444' }}>
            {auditChainValid ? '✓ Cryptographically Valid' : '✗ Chain Broken'}
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div style={styles.tabsRow}>
        <button
          style={activeTab === 'integrity' ? styles.activeTab : styles.tab}
          onClick={() => setActiveTab('integrity')}
        >
          🛡️ Integrity Status & Assets
        </button>
        <button
          style={activeTab === 'audit' ? styles.activeTab : styles.tab}
          onClick={() => setActiveTab('audit')}
        >
          📜 Immutable Audit Log ({auditData.length})
        </button>
        <button
          style={activeTab === 'config' ? styles.activeTab : styles.tab}
          onClick={() => setActiveTab('config')}
        >
          ⚙️ Configuration Integrity
        </button>
        <button
          style={activeTab === 'test' ? styles.activeTab : styles.tab}
          onClick={() => setActiveTab('test')}
        >
          🧪 Security Failure Injection
        </button>
        <button
          style={activeTab === 'biometric' ? styles.activeTab : styles.tab}
          onClick={() => setActiveTab('biometric')}
        >
          🧬 Biometric Integration Readiness
        </button>
      </div>

      {/* Tab 1: Integrity Status & Assets */}
      {activeTab === 'integrity' && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Protected System Components & SHA-256 Baselines</h2>
          <p style={styles.cardDesc}>
            All machine learning model (.pkl) files, configuration parameters, and environment files are continuously hashed and verified against unalterable baseline references.
          </p>

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Asset Name</th>
                <th style={styles.th}>Category</th>
                <th style={styles.th}>Path</th>
                <th style={styles.th}>Reference SHA-256 Hash</th>
                <th style={styles.th}>Current SHA-256 Hash</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {reportData?.components?.map((asset) => (
                <tr key={asset.id} style={asset.status === 'COMPROMISED' ? styles.compromisedRow : styles.tr}>
                  <td style={styles.td}><strong>{asset.name}</strong></td>
                  <td style={styles.td}>{asset.category}</td>
                  <td style={styles.td}><code style={styles.code}>{asset.path}</code></td>
                  <td style={styles.td}><code style={styles.code}>{asset.referenceHash ? asset.referenceHash.substring(0, 16) + '...' : 'N/A'}</code></td>
                  <td style={styles.td}><code style={styles.code}>{asset.currentHash ? asset.currentHash.substring(0, 16) + '...' : 'MISSING'}</code></td>
                  <td style={styles.td}>
                    <span style={asset.status === 'HEALTHY' ? styles.healthyTag : styles.compromisedTag}>
                      {asset.status}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {asset.status === 'COMPROMISED' && isLoggedIn && (
                      <button
                        style={styles.recertifyBtn}
                        onClick={() => handleRecertify(asset.id)}
                      >
                        Recertify Baseline
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 2: Immutable Audit Log */}
      {activeTab === 'audit' && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Append-Only Cryptographic Audit Trail</h2>
          <p style={styles.cardDesc}>
            Records all administrative authentication, configuration modifications, emergency policy updates, and integrity failures. Each entry is cryptographically chained to its predecessor.
          </p>

          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Timestamp</th>
                <th style={styles.th}>Admin ID</th>
                <th style={styles.th}>Action</th>
                <th style={styles.th}>Module</th>
                <th style={styles.th}>Result</th>
                <th style={styles.th}>IP Address</th>
                <th style={styles.th}>Cryptographic Entry Hash</th>
              </tr>
            </thead>
            <tbody>
              {auditData.map((log) => (
                <tr key={log.id} style={log.result === 'FAILURE' ? styles.failureRow : styles.tr}>
                  <td style={styles.td}>{new Date(log.timestamp).toLocaleString()}</td>
                  <td style={styles.td}><strong>{log.adminId}</strong></td>
                  <td style={styles.td}><code style={styles.code}>{log.action}</code></td>
                  <td style={styles.td}>{log.affectedModule}</td>
                  <td style={styles.td}>
                    <span style={log.result === 'SUCCESS' ? styles.healthyTag : styles.compromisedTag}>
                      {log.result}
                    </span>
                  </td>
                  <td style={styles.td}>{log.ipAddress}</td>
                  <td style={styles.td}><code style={styles.code}>{log.entryHash.substring(0, 16)}...</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: Configuration Integrity */}
      {activeTab === 'config' && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Protected Administrative Configuration Management</h2>
          <p style={styles.cardDesc}>
            Only authenticated administrators with valid JWT tokens can modify fraud thresholds, trust weights, and emergency policies. Modifications recalculate and re-certify file baseline SHA-256 hashes.
          </p>

          {!isLoggedIn && (
            <div style={styles.warningBox}>
              🔒 Administrative Authentication Required: Please log in using the "Admin Login" button above.
            </div>
          )}

          {isLocked && (
            <div style={styles.warningBox}>
              🔒 Administrative Mutations are Locked because System Integrity is currently COMPROMISED.
            </div>
          )}

          <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
            <label style={styles.label}>Select Module Configuration:</label>
            <select
              style={styles.select}
              value={configType}
              onChange={(e) => setConfigType(e.target.value)}
            >
              <option value="thresholds">Cost-Based Threshold Optimization</option>
              <option value="trustScore">Dynamic Trust Score Engine</option>
              <option value="riskClassification">Risk Classification Engine</option>
              <option value="emergencyPolicy">Emergency Mode & Safe Mode</option>
              <option value="temporaryLimits">Dynamic Temporary Limit Engine</option>
              <option value="driftMonitoring">Drift-Aware ML Monitoring</option>
            </select>
          </div>

          <textarea
            style={styles.jsonTextarea}
            rows={12}
            value={configJsonText}
            onChange={(e) => setConfigJsonText(e.target.value)}
            disabled={!isLoggedIn || isLocked}
          />

          <div style={{ marginTop: '15px' }}>
            <button
              style={styles.saveBtn}
              onClick={handleSaveConfig}
              disabled={!isLoggedIn || isLocked}
            >
              💾 Save & Recertify Baseline Hash
            </button>
          </div>
        </div>
      )}

      {/* Tab 4: Security Failure Injection */}
      {activeTab === 'test' && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Security & Failure Injection Test Workbench</h2>
          <p style={styles.cardDesc}>
            Simulate attacks and component tampering to test real-time SHA-256 detection, Critical Integrity Alert generation, admin lock enforcement, and ML prediction blocking.
          </p>

          <div style={styles.buttonGrid}>
            <button style={styles.dangerBtn} onClick={() => handleInjectFailure('model', 'tamper')}>
              💥 Inject ML Model (.pkl) Tampering
            </button>
            <button style={styles.dangerBtn} onClick={() => handleInjectFailure('threshold', 'tamper')}>
              💥 Tamper Fraud Threshold Config
            </button>
            <button style={styles.dangerBtn} onClick={() => handleInjectFailure('trust', 'delete')}>
              💥 Delete Trust Engine Config
            </button>
            <button style={styles.actionBtn} onClick={handleTestPrediction}>
              🤖 Test ML Fraud Prediction
            </button>
            <button style={styles.restoreBtn} onClick={handleRestoreBaselines}>
              🔄 Restore Clean Pristine Baselines
            </button>
          </div>

          {testResult && (
            <div style={{ marginTop: '20px' }}>
              <h4 style={{ color: '#F3F4F6' }}>Execution Test Result:</h4>
              <pre style={styles.preCode}>{JSON.stringify(testResult, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Biometric Integration Readiness */}
      {activeTab === 'biometric' && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Future Biometric Authentication Architecture Readiness</h2>
          <p style={styles.cardDesc}>
            Prepared architecture for future integration of Face Recognition, Fingerprint (WebAuthn), and Multi-Factor ESP32 Authorization without modifying existing fraud detection engines.
          </p>

          <div style={styles.workflowBox}>
            <div style={styles.workflowStep}>1. Transaction Trigger</div>
            <div style={styles.workflowArrow}>➔</div>
            <div style={styles.workflowStep}>2. ESP32 Hardware Auth</div>
            <div style={styles.workflowArrow}>➔</div>
            <div style={styles.workflowStepActive}>3. Biometric Step-Up (Future)</div>
            <div style={styles.workflowArrow}>➔</div>
            <div style={styles.workflowStep}>4. Adaptive Auth Engine</div>
          </div>

          <div style={{ display: 'flex', gap: '10px', margin: '20px 0' }}>
            <button style={styles.actionBtn} onClick={() => handleTestBiometric('FACE_RECOGNITION')}>
              👤 Test Face Recognition Stub
            </button>
            <button style={styles.actionBtn} onClick={() => handleTestBiometric('FINGERPRINT')}>
              👆 Test Fingerprint Stub
            </button>
            <button style={styles.actionBtn} onClick={() => handleTestBiometric('ESP32_BIOMETRIC')}>
              🔐 Test ESP32 + Biometric MFA Stub
            </button>
          </div>

          {testResult && (
            <div>
              <h4 style={{ color: '#F3F4F6' }}>Biometric Adapter Output:</h4>
              <pre style={styles.preCode}>{JSON.stringify(testResult, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {/* Auth Modal */}
      {isAuthModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalContent}>
            <h3>🔐 Administrative Login</h3>
            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: '12px' }}>
                <label style={styles.label}>Admin Username:</label>
                <input
                  type="text"
                  style={styles.input}
                  value={adminUser}
                  onChange={(e) => setAdminUser(e.target.value)}
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={styles.label}>Admin Password:</label>
                <input
                  type="password"
                  style={styles.input}
                  value={adminPass}
                  onChange={(e) => setAdminPass(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button type="button" style={styles.cancelBtn} onClick={() => setIsAuthModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" style={styles.saveBtn}>
                  Authenticate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    minHeight: '100vh',
    padding: '24px',
    fontFamily: 'Inter, system-ui, sans-serif'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
    borderBottom: '1px solid #1E293B',
    paddingBottom: '16px'
  },
  title: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#F8FAFC',
    margin: 0
  },
  subtitle: {
    fontSize: '13px',
    color: '#94A3B8',
    marginTop: '4px'
  },
  healthyBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#10B981',
    border: '1px solid #10B981',
    padding: '4px 12px',
    borderRadius: '16px',
    fontSize: '12px',
    fontWeight: '600'
  },
  compromisedBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    color: '#EF4444',
    border: '1px solid #EF4444',
    padding: '4px 12px',
    borderRadius: '16px',
    fontSize: '12px',
    fontWeight: '600',
    animation: 'pulse 1.5s infinite'
  },
  lockedBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    color: '#F59E0B',
    border: '1px solid #F59E0B',
    padding: '4px 12px',
    borderRadius: '16px',
    fontSize: '12px',
    fontWeight: '600'
  },
  scanBtn: {
    backgroundColor: '#3B82F6',
    color: '#FFFFFF',
    border: 'none',
    padding: '10px 16px',
    borderRadius: '8px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  loginBtn: {
    backgroundColor: '#8B5CF6',
    color: '#FFFFFF',
    border: 'none',
    padding: '10px 16px',
    borderRadius: '8px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  logoutBtn: {
    backgroundColor: '#475569',
    color: '#FFFFFF',
    border: 'none',
    padding: '10px 16px',
    borderRadius: '8px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '16px',
    marginBottom: '24px'
  },
  statCard: {
    backgroundColor: '#1E293B',
    border: '1px solid #334155',
    padding: '16px',
    borderRadius: '12px'
  },
  statLabel: {
    fontSize: '12px',
    color: '#94A3B8',
    fontWeight: '500'
  },
  statValue: {
    fontSize: '20px',
    fontWeight: '700',
    marginTop: '6px'
  },
  tabsRow: {
    display: 'flex',
    gap: '8px',
    marginBottom: '20px',
    borderBottom: '1px solid #334155'
  },
  tab: {
    backgroundColor: 'transparent',
    color: '#94A3B8',
    border: 'none',
    borderBottom: '2px solid transparent',
    padding: '12px 18px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  activeTab: {
    backgroundColor: 'transparent',
    color: '#60A5FA',
    borderBottom: '2px solid #60A5FA',
    padding: '12px 18px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  card: {
    backgroundColor: '#1E293B',
    border: '1px solid #334155',
    borderRadius: '12px',
    padding: '24px'
  },
  cardTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#F8FAFC',
    margin: '0 0 6px 0'
  },
  cardDesc: {
    fontSize: '13px',
    color: '#94A3B8',
    marginBottom: '20px'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  th: {
    textAlign: 'left',
    padding: '12px',
    fontSize: '12px',
    color: '#94A3B8',
    borderBottom: '1px solid #334155'
  },
  tr: {
    borderBottom: '1px solid #334155'
  },
  compromisedRow: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderBottom: '1px solid #EF4444'
  },
  failureRow: {
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    borderBottom: '1px solid #334155'
  },
  td: {
    padding: '12px',
    fontSize: '13px'
  },
  code: {
    fontFamily: 'monospace',
    backgroundColor: '#0F172A',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '12px',
    color: '#38BDF8'
  },
  healthyTag: {
    color: '#10B981',
    fontWeight: '600',
    fontSize: '12px'
  },
  compromisedTag: {
    color: '#EF4444',
    fontWeight: '600',
    fontSize: '12px'
  },
  recertifyBtn: {
    backgroundColor: '#D97706',
    color: '#FFFFFF',
    border: 'none',
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    cursor: 'pointer'
  },
  criticalAlertBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid #EF4444',
    padding: '16px',
    borderRadius: '12px',
    marginBottom: '20px',
    color: '#FCA5A5'
  },
  errorMessage: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    border: '1px solid #EF4444',
    color: '#F8FAFC',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '16px',
    display: 'flex',
    justifyContent: 'space-between'
  },
  successMessage: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    border: '1px solid #10B981',
    color: '#F8FAFC',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '16px',
    display: 'flex',
    justifyContent: 'space-between'
  },
  closeMsgBtn: {
    background: 'none',
    border: 'none',
    color: '#FFFFFF',
    cursor: 'pointer',
    fontWeight: 'bold'
  },
  warningBox: {
    backgroundColor: '#7C2D12',
    color: '#FFEDD5',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '16px',
    fontSize: '13px'
  },
  label: {
    fontSize: '13px',
    color: '#CBD5E1',
    fontWeight: '600'
  },
  select: {
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    border: '1px solid #334155',
    padding: '8px 12px',
    borderRadius: '6px'
  },
  jsonTextarea: {
    width: '100%',
    backgroundColor: '#0F172A',
    color: '#38BDF8',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '12px',
    fontFamily: 'monospace',
    fontSize: '13px'
  },
  saveBtn: {
    backgroundColor: '#10B981',
    color: '#FFFFFF',
    border: 'none',
    padding: '10px 18px',
    borderRadius: '8px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  buttonGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    marginBottom: '20px'
  },
  dangerBtn: {
    backgroundColor: '#DC2626',
    color: '#FFFFFF',
    border: 'none',
    padding: '10px 16px',
    borderRadius: '8px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  actionBtn: {
    backgroundColor: '#2563EB',
    color: '#FFFFFF',
    border: 'none',
    padding: '10px 16px',
    borderRadius: '8px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  restoreBtn: {
    backgroundColor: '#059669',
    color: '#FFFFFF',
    border: 'none',
    padding: '10px 16px',
    borderRadius: '8px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  preCode: {
    backgroundColor: '#0F172A',
    color: '#A5F3FC',
    padding: '12px',
    borderRadius: '8px',
    overflowX: 'auto',
    fontSize: '12px'
  },
  workflowBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: '#0F172A',
    padding: '16px',
    borderRadius: '10px'
  },
  workflowStep: {
    backgroundColor: '#334155',
    padding: '8px 14px',
    borderRadius: '6px',
    fontSize: '13px'
  },
  workflowStepActive: {
    backgroundColor: '#8B5CF6',
    color: '#FFFFFF',
    padding: '8px 14px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600'
  },
  workflowArrow: {
    color: '#64748B'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modalContent: {
    backgroundColor: '#1E293B',
    border: '1px solid #334155',
    borderRadius: '12px',
    padding: '24px',
    width: '360px'
  },
  input: {
    width: '100%',
    backgroundColor: '#0F172A',
    color: '#F8FAFC',
    border: '1px solid #334155',
    padding: '8px 12px',
    borderRadius: '6px',
    marginTop: '4px'
  },
  cancelBtn: {
    backgroundColor: '#475569',
    color: '#FFFFFF',
    border: 'none',
    padding: '8px 14px',
    borderRadius: '6px',
    cursor: 'pointer'
  }
};
