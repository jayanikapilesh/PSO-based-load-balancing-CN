import fs from 'fs';
import path from 'path';
import { generateAdminJwt } from '../middleware/auth.middleware.js';
import { recordAuditLog, getAuditLogs, verifyAuditChainIntegrity } from '../services/audit.service.js';
import {
  getIntegrityStatus,
  getIntegrityReport,
  verifySystemIntegrity,
  updateBaselineHash,
  initializeIntegrityBaselines,
  calculateFileHash
} from '../services/integrity.service.js';
import { executeFraudPrediction } from '../services/model_integrity.service.js';
import { defaultBiometricProvider } from '../services/biometric_adapter.interface.js';

/**
 * POST /admin/auth/login
 * Administrative Authentication
 */
export async function adminLogin(req, res) {
  try {
    const { username, password } = req.body;
    const ipAddress = req.ip || req.socket.remoteAddress || '127.0.0.1';

    // Default admin credentials for PoC / Demo platform
    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASS || 'AdminPass2026!';

    if (username === ADMIN_USER && password === ADMIN_PASS) {
      const token = generateAdminJwt('admin-01', 'admin');
      recordAuditLog({
        adminId: 'admin-01',
        action: 'ADMIN_LOGIN_SUCCESS',
        affectedModule: 'Administrative Authentication',
        ipAddress,
        result: 'SUCCESS',
        details: 'Admin successfully authenticated'
      });
      return res.status(200).json({
        message: 'Administrative authentication successful',
        token,
        admin: {
          id: 'admin-01',
          username: 'admin',
          role: 'admin'
        }
      });
    }

    recordAuditLog({
      adminId: username || 'UNKNOWN',
      action: 'ADMIN_LOGIN_FAILURE',
      affectedModule: 'Administrative Authentication',
      ipAddress,
      result: 'FAILURE',
      details: 'Invalid admin credentials provided'
    });

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid administrative credentials'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error during login', details: err.message });
  }
}

/**
 * GET /admin/integrity/status
 * Integrity Dashboard Overview
 */
export async function getSystemIntegrityStatus(req, res) {
  try {
    const status = getIntegrityStatus();
    return res.status(200).json(status);
  } catch (err) {
    return res.status(500).json({ error: 'Error fetching integrity status', details: err.message });
  }
}

/**
 * GET /admin/integrity/report
 * Detailed System Integrity Report
 */
export async function getSystemIntegrityReport(req, res) {
  try {
    const report = getIntegrityReport();
    return res.status(200).json(report);
  } catch (err) {
    return res.status(500).json({ error: 'Error generating integrity report', details: err.message });
  }
}

/**
 * POST /admin/integrity/verify
 * Triggers manual SHA-256 verification scan
 */
export async function runManualIntegrityVerification(req, res) {
  try {
    const adminId = req.admin?.sub || 'ADMIN_API';
    const result = verifySystemIntegrity(`MANUAL_SCAN_BY_${adminId}`);

    recordAuditLog({
      adminId,
      action: 'MANUAL_INTEGRITY_VERIFICATION_TRIGGERED',
      affectedModule: 'SystemIntegrity',
      result: result.overallStatus === 'HEALTHY' ? 'SUCCESS' : 'FAILURE',
      details: `Manual integrity scan completed. Status: ${result.overallStatus}, Compromised assets: ${result.compromisedComponentsCount}`
    });

    return res.status(200).json({
      message: 'Integrity verification completed',
      scanResult: result
    });
  } catch (err) {
    return res.status(500).json({ error: 'Manual verification failed', details: err.message });
  }
}

/**
 * GET /admin/audit/logs
 * Retrieve append-only audit log entries
 */
export async function getAdminAuditLogs(req, res) {
  try {
    const { module: affectedModule, action, result, adminId } = req.query;
    const logs = getAuditLogs({ module: affectedModule, action, result, adminId });
    const chainIntegrity = verifyAuditChainIntegrity();

    return res.status(200).json({
      totalLogs: logs.length,
      auditChainValid: chainIntegrity.valid,
      chainDetails: chainIntegrity,
      logs
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error retrieving audit logs', details: err.message });
  }
}

/**
 * POST /admin/integrity/recertify
 * Allows authorized admin to re-certify baseline hash after manual investigation
 */
export async function recertifyComponentBaseline(req, res) {
  try {
    const { assetId } = req.body;
    const adminId = req.admin.sub;

    if (!assetId) {
      return res.status(400).json({ error: 'assetId is required' });
    }

    const updatedScan = updateBaselineHash(assetId, adminId);
    return res.status(200).json({
      message: `Component ${assetId} baseline recertified successfully`,
      updatedScan
    });
  } catch (err) {
    return res.status(400).json({ error: 'Recertification failed', details: err.message });
  }
}

// ─── Configuration Management Controllers (Protected by JWT + Admin Role + Integrity Lock Check) ───

function updateConfigFile(configPath, newContent, moduleName, req, res) {
  const fullPath = path.resolve(configPath);
  const adminId = req.admin.sub;
  const ipAddress = req.ip || '127.0.0.1';

  let previousContent = 'N/A';
  if (fs.existsSync(fullPath)) {
    previousContent = fs.readFileSync(fullPath, 'utf-8');
  }

  fs.writeFileSync(fullPath, JSON.stringify(newContent, null, 2));

  // Update hash baseline so legitimate admin change is certified
  const assetIdMap = {
    'src/config/fraud_thresholds.json': 'cfg-fraud-thresholds',
    'src/config/trust_engine_config.json': 'cfg-trust-engine',
    'src/config/risk_classification_config.json': 'cfg-risk-classification',
    'src/config/drift_monitoring_config.json': 'cfg-drift-monitoring',
    'src/config/emergency_policy_config.json': 'cfg-emergency-policy',
    'src/config/temporary_limit_config.json': 'cfg-temporary-limit'
  };

  const assetId = assetIdMap[configPath];
  if (assetId) {
    updateBaselineHash(assetId, adminId);
  }

  recordAuditLog({
    adminId,
    action: `${moduleName.toUpperCase().replace(/\s+/g, '_')}_UPDATE`,
    affectedModule: moduleName,
    previousValue: previousContent,
    newValue: JSON.stringify(newContent),
    ipAddress,
    result: 'SUCCESS',
    details: `Admin ${adminId} updated ${moduleName} configuration.`
  });

  return res.status(200).json({
    message: `${moduleName} updated successfully`,
    config: newContent
  });
}

export async function updateFraudThresholds(req, res) {
  return updateConfigFile('src/config/fraud_thresholds.json', req.body, 'Cost-Based Threshold Optimization', req, res);
}

export async function updateTrustEngineConfig(req, res) {
  return updateConfigFile('src/config/trust_engine_config.json', req.body, 'Dynamic Trust Score Engine', req, res);
}

export async function updateRiskClassificationConfig(req, res) {
  return updateConfigFile('src/config/risk_classification_config.json', req.body, 'Risk Classification Engine', req, res);
}

export async function updateEmergencyPolicies(req, res) {
  return updateConfigFile('src/config/emergency_policy_config.json', req.body, 'Emergency Mode', req, res);
}

export async function updateTemporaryLimits(req, res) {
  return updateConfigFile('src/config/temporary_limit_config.json', req.body, 'Dynamic Temporary Limit Engine', req, res);
}

export async function updateDriftMonitoringConfig(req, res) {
  return updateConfigFile('src/config/drift_monitoring_config.json', req.body, 'Drift-Aware Machine Learning Monitoring', req, res);
}

// ─── Testing & Failure Injection Simulation Controllers ───

/**
 * POST /admin/test/inject-failure
 * Simulates unauthorized tampering or corruption for automated/manual security testing
 */
export async function injectFailureSimulation(req, res) {
  try {
    const { target, type } = req.body; // target: 'model' | 'threshold' | 'trust' | 'env' | 'delete_config', type: 'tamper' | 'corrupt' | 'delete'

    const targetMap = {
      model: 'src/models_store/fraud_detection_model.pkl',
      threshold: 'src/config/fraud_thresholds.json',
      trust: 'src/config/trust_engine_config.json',
      env: '.env'
    };

    const filePath = targetMap[target] || 'src/config/fraud_thresholds.json';
    const fullPath = path.resolve(filePath);

    if (type === 'delete') {
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } else {
      const tamperData = `UNAUTHORIZED_TAMPERING_PAYLOAD_${Date.now()}_SECURITY_TEST`;
      fs.writeFileSync(fullPath, tamperData);
    }

    // Trigger immediate verification scan
    const scan = verifySystemIntegrity('FAILURE_INJECTION_TEST');

    return res.status(200).json({
      message: `Simulated failure injected on ${target} (${type})`,
      targetFile: filePath,
      scanResult: scan
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failure injection error', details: err.message });
  }
}

/**
 * POST /admin/test/restore-baselines
 * Restores baseline test files to clean state
 */
export async function restoreBaselines(req, res) {
  try {
    // Write back clean files
    fs.writeFileSync(path.resolve('src/models_store/fraud_detection_model.pkl'),
      'PKL_MODEL_V1_SHA256_VERIFIED_FRAUD_PREVENTION_ML_MODEL_ARTIFACT_TREE_CLASSIFIER_2026_PRODUCTION_APPROVED\nModel Architecture: GradientBoostingFraudClassifier\nInput Features: [holdTime, flightTime, typingSpeed, anomalyScore, velocity, amount, trustScore]\nSerialization Format: Pickle / Binary\nVersion: 1.0.4-prod\nApprovedBy: SecurityAdmin-01\nApprovedAt: 2026-07-28T00:00:00Z\nStatus: APPROVED_PRODUCTION_BASELINE\n'
    );

    fs.writeFileSync(path.resolve('src/config/fraud_thresholds.json'), JSON.stringify({
      module: "Cost-Based Threshold Optimization",
      version: "1.0.0",
      updatedAt: new Date().toISOString(),
      thresholds: { lowRiskMaxAmount: 500.0, mediumRiskMaxAmount: 2500.0, highRiskMaxAmount: 10000.0, anomalyScoreThreshold: 0.75, velocityLimitPerMinute: 5 }
    }, null, 2));

    fs.writeFileSync(path.resolve('src/config/trust_engine_config.json'), JSON.stringify({
      module: "Dynamic Trust Score Engine",
      version: "1.0.0",
      updatedAt: new Date().toISOString(),
      weights: { behavioralBiometricsWeight: 0.35, deviceFingerprintWeight: 0.25, transactionHistoryWeight: 0.20, ipReputationWeight: 0.20 },
      trustScoreThresholds: { trusted: 80, neutral: 50, untrusted: 30 }
    }, null, 2));

    if (!fs.existsSync(path.resolve('.env'))) {
      fs.writeFileSync(path.resolve('.env'), 'PORT=5000\n');
    }

    // Force rebase baseline store
    const scan = initializeIntegrityBaselines(true);

    return res.status(200).json({
      message: 'Baselines and protected assets successfully restored to pristine state',
      scanResult: scan
    });
  } catch (err) {
    return res.status(500).json({ error: 'Restore baselines failed', details: err.message });
  }
}

/**
 * POST /admin/test/predict
 * Test prediction with Model Integrity Guard
 */
export async function testPredictionWithIntegrityCheck(req, res) {
  try {
    const { amount = 1500, anomalyScore = 0.2 } = req.body;
    const result = executeFraudPrediction({ amount, anomalyScore });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(400).json({
      error: 'Model Integrity Violation',
      message: err.message
    });
  }
}

/**
 * POST /admin/test/biometric-stub
 * Test Biometric Adapter Stub readiness
 */
export async function testBiometricAdapter(req, res) {
  try {
    const { userId = 'user-101', factor = 'FACE_RECOGNITION' } = req.body;
    let result;
    if (factor === 'FACE_RECOGNITION') {
      result = await defaultBiometricProvider.verifyFace(userId, {});
    } else if (factor === 'FINGERPRINT') {
      result = await defaultBiometricProvider.verifyFingerprint(userId, {});
    } else {
      result = await defaultBiometricProvider.verifyMultiFactor(userId, 'ESP32-TOKEN-9988', {});
    }
    return res.status(200).json({
      architectureReady: true,
      biometricProvider: defaultBiometricProvider.providerName,
      result
    });
  } catch (err) {
    return res.status(500).json({ error: 'Biometric test failed', details: err.message });
  }
}
