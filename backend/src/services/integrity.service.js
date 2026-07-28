import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { recordAuditLog } from './audit.service.js';

const BASELINE_STORE_PATH = path.resolve('src/security/integrity_baselines.json');

// List of critical system assets protected by SHA-256 hashing
const PROTECTED_ASSETS = [
  { id: 'ml-model-pkl', name: 'Fraud Detection ML Model (.pkl)', path: 'src/models_store/fraud_detection_model.pkl', category: 'Machine Learning Model' },
  { id: 'cfg-fraud-thresholds', name: 'Fraud Threshold Configuration', path: 'src/config/fraud_thresholds.json', category: 'Configuration' },
  { id: 'cfg-trust-engine', name: 'Trust Engine Configuration', path: 'src/config/trust_engine_config.json', category: 'Trust Engine' },
  { id: 'cfg-risk-classification', name: 'Risk Classification Configuration', path: 'src/config/risk_classification_config.json', category: 'Risk Classification' },
  { id: 'cfg-drift-monitoring', name: 'Drift Monitoring Configuration', path: 'src/config/drift_monitoring_config.json', category: 'Drift Monitoring' },
  { id: 'cfg-emergency-policy', name: 'Emergency Policy Configuration', path: 'src/config/emergency_policy_config.json', category: 'Emergency Mode' },
  { id: 'cfg-temporary-limit', name: 'Temporary Limit Configuration', path: 'src/config/temporary_limit_config.json', category: 'Temporary Limit Engine' },
  { id: 'cfg-api', name: 'API Security Configuration', path: 'src/config/api_config.json', category: 'API Security' },
  { id: 'env-config', name: 'Environment Configuration (.env)', path: '.env', category: 'Environment' }
];

let cachedBaselineHashes = null;
let activeAlerts = [];
let overallStatus = 'HEALTHY'; // 'HEALTHY' | 'COMPROMISED'
let lastVerificationTime = null;
let isAdminLocked = false;

/**
 * Calculates SHA-256 hash of a file on disk.
 */
export function calculateFileHash(relativePath) {
  const fullPath = path.resolve(relativePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  const fileBuffer = fs.readFileSync(fullPath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

/**
 * Ensures security baseline store directory and baseline file exist.
 * Generates baseline hashes on system deployment / initial setup.
 */
export function initializeIntegrityBaselines(forceRebase = false) {
  const securityDir = path.dirname(BASELINE_STORE_PATH);
  if (!fs.existsSync(securityDir)) {
    fs.mkdirSync(securityDir, { recursive: true });
  }

  const fileExists = fs.existsSync(BASELINE_STORE_PATH);

  if (!fileExists || forceRebase) {
    console.log('[System Integrity] Generating reference SHA-256 hashes for baseline assets...');
    const baselines = {};
    for (const asset of PROTECTED_ASSETS) {
      const fileHash = calculateFileHash(asset.path);
      baselines[asset.id] = {
        ...asset,
        referenceHash: fileHash,
        createdAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString()
      };
    }
    fs.writeFileSync(BASELINE_STORE_PATH, JSON.stringify(baselines, null, 2));
    cachedBaselineHashes = baselines;
    
    recordAuditLog({
      adminId: 'SYSTEM_INIT',
      action: forceRebase ? 'INTEGRITY_BASELINE_RECERTIFIED' : 'INTEGRITY_BASELINE_GENERATED',
      affectedModule: 'SystemIntegrity',
      previousValue: forceRebase ? 'PREVIOUS_BASELINE' : 'NONE',
      newValue: 'NEW_BASELINE_CERTIFIED',
      result: 'SUCCESS',
      details: `Generated SHA-256 baselines for ${PROTECTED_ASSETS.length} assets.`
    });
  } else {
    const raw = fs.readFileSync(BASELINE_STORE_PATH, 'utf-8');
    cachedBaselineHashes = JSON.parse(raw);
  }

  // Execute initial verification on startup
  return verifySystemIntegrity('SYSTEM_STARTUP');
}

/**
 * Continuously / periodically recompute SHA-256 hashes of protected assets
 * and compare against baseline reference hashes.
 *
 * CRITICAL DIRECTIVE: Must NOT automatically overwrite reference hashes upon mismatch.
 */
export function verifySystemIntegrity(triggerSource = 'PERIODIC_SCAN') {
  if (!cachedBaselineHashes) {
    initializeIntegrityBaselines();
  }

  const verificationTime = new Date().toISOString();
  lastVerificationTime = verificationTime;

  const componentResults = [];
  const newAlerts = [];
  let foundMismatch = false;

  for (const asset of PROTECTED_ASSETS) {
    const baseline = cachedBaselineHashes[asset.id];
    const currentHash = calculateFileHash(asset.path);
    const expectedHash = baseline ? baseline.referenceHash : null;

    let componentStatus = 'HEALTHY';
    let issueDescription = null;

    if (currentHash === null) {
      componentStatus = 'COMPROMISED';
      issueDescription = 'File is missing or deleted from filesystem.';
      foundMismatch = true;
    } else if (expectedHash && currentHash !== expectedHash) {
      componentStatus = 'COMPROMISED';
      issueDescription = `SHA-256 hash mismatch detected. Current: ${currentHash.substring(0, 12)}... | Expected: ${expectedHash.substring(0, 12)}...`;
      foundMismatch = true;
    }

    if (componentStatus === 'COMPROMISED') {
      const alert = {
        id: `ALERT-${asset.id}-${Date.now()}`,
        assetId: asset.id,
        assetName: asset.name,
        category: asset.category,
        filePath: asset.path,
        severity: 'CRITICAL',
        issue: issueDescription,
        expectedHash: expectedHash || 'N/A',
        currentHash: currentHash || 'FILE_MISSING',
        detectedAt: verificationTime
      };
      newAlerts.push(alert);

      // Record in immutable audit log
      recordAuditLog({
        adminId: triggerSource,
        action: 'INTEGRITY_MISMATCH_DETECTED',
        affectedModule: asset.category,
        previousValue: expectedHash,
        newValue: currentHash || 'FILE_MISSING',
        result: 'FAILURE',
        details: `Critical Integrity Alert for ${asset.name}: ${issueDescription}`
      });
    }

    componentResults.push({
      id: asset.id,
      name: asset.name,
      category: asset.category,
      path: asset.path,
      status: componentStatus,
      referenceHash: expectedHash,
      currentHash: currentHash || 'FILE_MISSING',
      issue: issueDescription,
      lastChecked: verificationTime
    });
  }

  if (foundMismatch) {
    overallStatus = 'COMPROMISED';
    isAdminLocked = true;
    activeAlerts = newAlerts;
    console.error(`[CRITICAL INTEGRITY ALERT] System Integrity Verification FAILED! ${newAlerts.length} components compromised.`);
  } else {
    overallStatus = 'HEALTHY';
    isAdminLocked = false;
    activeAlerts = [];
  }

  return {
    overallStatus,
    isAdminLocked,
    lastVerificationTime,
    totalProtectedComponents: PROTECTED_ASSETS.length,
    compromisedComponentsCount: newAlerts.length,
    activeAlerts,
    components: componentResults
  };
}

/**
 * Returns overall integrity status for API.
 */
export function getIntegrityStatus() {
  if (!lastVerificationTime) {
    verifySystemIntegrity('INITIAL_STATUS_QUERY');
  }
  return {
    overallStatus,
    isAdminLocked,
    lastVerificationTime,
    activeAlertsCount: activeAlerts.length,
    activeAlerts,
    message: overallStatus === 'HEALTHY'
      ? 'System integrity verified. All ML models and configurations match baseline hashes.'
      : 'CRITICAL WARNING: System component tampering detected! Administrative mutations locked.'
  };
}

/**
 * Returns complete granular integrity report.
 */
export function getIntegrityReport() {
  return verifySystemIntegrity('REPORT_QUERY');
}

/**
 * Checks if system is currently locked due to integrity compromise.
 */
export function isSystemLocked() {
  return isAdminLocked;
}

/**
 * Updates a baseline file hash AFTER explicit admin authorization and verification.
 * Does NOT overwrite automatically upon mismatch.
 */
export function updateBaselineHash(assetId, adminId) {
  if (!cachedBaselineHashes[assetId]) {
    throw new Error(`Invalid asset ID: ${assetId}`);
  }
  const asset = cachedBaselineHashes[assetId];
  const newHash = calculateFileHash(asset.path);

  if (!newHash) {
    throw new Error(`Cannot update baseline hash for missing file: ${asset.path}`);
  }

  const oldHash = asset.referenceHash;
  asset.referenceHash = newHash;
  asset.verifiedAt = new Date().toISOString();

  fs.writeFileSync(BASELINE_STORE_PATH, JSON.stringify(cachedBaselineHashes, null, 2));

  recordAuditLog({
    adminId,
    action: 'BASELINE_HASH_REVERT_OR_UPDATE',
    affectedModule: asset.category,
    previousValue: oldHash,
    newValue: newHash,
    result: 'SUCCESS',
    details: `Admin ${adminId} re-certified reference baseline for ${asset.name}`
  });

  // Re-verify after manual recertification
  return verifySystemIntegrity(`MANUAL_RECERTIFICATION_BY_${adminId}`);
}
