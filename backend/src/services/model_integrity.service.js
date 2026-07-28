import fs from 'fs';
import path from 'path';
import { calculateFileHash } from './integrity.service.js';
import { recordAuditLog } from './audit.service.js';

const MODEL_PATH = 'src/models_store/fraud_detection_model.pkl';

/**
 * Validates ML model integrity prior to processing fraud prediction requests.
 * Throws an explicit error and logs violation if model is missing or tampered.
 */
export function validateModelIntegrityBeforePrediction() {
  const fullPath = path.resolve(MODEL_PATH);

  // 1. Availability check
  if (!fs.existsSync(fullPath)) {
    recordAuditLog({
      adminId: 'PREDICTION_ENGINE',
      action: 'MODEL_UNAVAILABLE',
      affectedModule: 'Machine Learning Fraud Detection',
      result: 'FAILURE',
      details: `Deployed model file missing at path: ${MODEL_PATH}`
    });
    throw new Error(`[MODEL INTEGRITY VIOLATION] Model file ${MODEL_PATH} is missing! Prediction aborted.`);
  }

  // 2. Hash integrity check
  const currentHash = calculateFileHash(MODEL_PATH);
  
  // Read expected baseline hash from baseline store
  let expectedHash = null;
  try {
    const baselinesRaw = fs.readFileSync(path.resolve('src/security/integrity_baselines.json'), 'utf-8');
    const baselines = JSON.parse(baselinesRaw);
    if (baselines['ml-model-pkl']) {
      expectedHash = baselines['ml-model-pkl'].referenceHash;
    }
  } catch (err) {
    console.error('Error reading baseline store during model prediction check:', err);
  }

  if (expectedHash && currentHash !== expectedHash) {
    recordAuditLog({
      adminId: 'PREDICTION_ENGINE',
      action: 'MODEL_INTEGRITY_VIOLATION',
      affectedModule: 'Machine Learning Fraud Detection',
      previousValue: expectedHash,
      newValue: currentHash,
      result: 'FAILURE',
      details: `ML Model hash mismatch! Expected: ${expectedHash.substring(0, 10)}..., Found: ${currentHash.substring(0, 10)}...`
    });

    throw new Error('[MODEL INTEGRITY VIOLATION] Deployed ML Model (.pkl) has been modified or corrupted! Prediction execution blocked.');
  }

  return {
    valid: true,
    modelPath: MODEL_PATH,
    sha256Hash: currentHash
  };
}

/**
 * Mock prediction execution service incorporating Model Integrity Protection.
 */
export function executeFraudPrediction(transactionFeatures) {
  // Validate model integrity before proceeding
  const integrityCheck = validateModelIntegrityBeforePrediction();

  // Simulating prediction calculation using validated model
  const riskScore = Math.min(1.0, Math.max(0.0, (transactionFeatures.amount || 100) / 10000 + (transactionFeatures.anomalyScore || 0.1)));

  return {
    success: true,
    modelVerified: true,
    modelSha256: integrityCheck.sha256Hash.substring(0, 12) + '...',
    riskScore,
    classification: riskScore > 0.7 ? 'HIGH' : (riskScore > 0.3 ? 'MEDIUM' : 'LOW'),
    timestamp: new Date().toISOString()
  };
}
