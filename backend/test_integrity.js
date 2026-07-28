import fs from 'fs';
import path from 'path';
import { initializeIntegrityBaselines, verifySystemIntegrity, getIntegrityStatus } from './src/services/integrity.service.js';
import { recordAuditLog, getAuditLogs, verifyAuditChainIntegrity } from './src/services/audit.service.js';
import { generateAdminJwt, verifyJwtToken } from './src/middleware/auth.middleware.js';
import { validateModelIntegrityBeforePrediction, executeFraudPrediction } from './src/services/model_integrity.service.js';
import { defaultBiometricProvider } from './src/services/biometric_adapter.interface.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASSED: ${message}`);
  } else {
    console.error(`  ✗ FAILED: ${message}`);
  }
}

async function runTests() {
  console.log('===========================================================');
  console.log('  ADMIN-SIDE SYSTEM INTEGRITY MODULE TEST SUITE');
  console.log('===========================================================\n');

  // 0. Environment Setup & Clean Baselines
  console.log('[TEST GROUP 1] Initialization & Pristine Integrity Baseline Verification');
  const initResult = initializeIntegrityBaselines(true);
  assert(initResult.overallStatus === 'HEALTHY', 'Pristine system initialized with HEALTHY integrity status');
  assert(initResult.totalProtectedComponents === 9, 'All 9 protected assets (ML model, configs, env) registered');
  assert(initResult.compromisedComponentsCount === 0, 'Zero compromised components in pristine state');

  // 1. Audit Log Immutability & Hash Chaining Test
  console.log('\n[TEST GROUP 2] Immutable Cryptographic Audit Trail');
  recordAuditLog({
    adminId: 'test-admin',
    action: 'TEST_ADMIN_ACTION',
    affectedModule: 'TestModule',
    previousValue: 'val1',
    newValue: 'val2',
    result: 'SUCCESS'
  });
  const logs = getAuditLogs();
  assert(logs.length > 0, 'Audit log correctly appends administrative events');
  const chainCheck = verifyAuditChainIntegrity();
  assert(chainCheck.valid === true, 'Audit log cryptographic hash chain is valid and untampered');

  // 2. JWT Authentication & Role-Based Security Test
  console.log('\n[TEST GROUP 3] Administrative Authentication & RBAC');
  const token = generateAdminJwt('admin-01', 'admin');
  assert(typeof token === 'string' && token.length > 20, 'Generates signed JWT for admin role');
  const decoded = verifyJwtToken(token);
  assert(decoded && decoded.sub === 'admin-01' && decoded.role === 'admin', 'Validates JWT signature and extracts claims');
  const invalidToken = verifyJwtToken(token + 'INVALID_SIG');
  assert(invalidToken === null, 'Rejects tampered JWT signatures');

  // 3. Model Integrity Protection Test
  console.log('\n[TEST GROUP 4] Machine Learning Model Integrity Protection');
  const predTest = executeFraudPrediction({ amount: 2000, anomalyScore: 0.1 });
  assert(predTest.success === true && predTest.modelVerified === true, 'Untampered model (.pkl) passes pre-prediction integrity check');

  // 4. Failure Injection & Tamper Detection Testing
  console.log('\n[TEST GROUP 5] Failure Injection & Tampering Detection');
  
  // 4a. Tamper ML Model file
  console.log(' -> Simulating ML Model file tampering...');
  const modelPath = path.resolve('src/models_store/fraud_detection_model.pkl');
  const originalModelContent = fs.readFileSync(modelPath, 'utf-8');
  fs.writeFileSync(modelPath, originalModelContent + '\n# TAMPERED_BY_ATTACKER_INJECTION');

  const verifyAfterTamper = verifySystemIntegrity('FAILURE_INJECTION_TEST');
  assert(verifyAfterTamper.overallStatus === 'COMPROMISED', 'Detected ML Model tampering and flagged overall status as COMPROMISED');
  assert(verifyAfterTamper.compromisedComponentsCount > 0, 'Generated Critical Integrity Alert for tampered component');
  assert(verifyAfterTamper.isAdminLocked === true, 'Activated Administrative Modification Lock');

  // Verify prediction is blocked on tampered model
  let predictionBlocked = false;
  try {
    executeFraudPrediction({ amount: 1000, anomalyScore: 0.1 });
  } catch (err) {
    if (err.message.includes('MODEL INTEGRITY VIOLATION')) {
      predictionBlocked = true;
    }
  }
  assert(predictionBlocked === true, 'Blocked prediction execution when model SHA-256 hash mismatch was detected');

  // Restore model file and reset
  fs.writeFileSync(modelPath, originalModelContent);
  initializeIntegrityBaselines(true);

  // 4b. Tamper Fraud Threshold configuration file
  console.log(' -> Simulating Fraud Threshold configuration tampering...');
  const threshPath = path.resolve('src/config/fraud_thresholds.json');
  const origThresh = fs.readFileSync(threshPath, 'utf-8');
  fs.writeFileSync(threshPath, JSON.stringify({ tampered: true, lowRiskMaxAmount: 99999999 }));

  const verifyThreshTamper = verifySystemIntegrity('TAMPER_CONFIG_TEST');
  assert(verifyThreshTamper.overallStatus === 'COMPROMISED', 'Detected Fraud Threshold configuration tampering');

  // Verify that system did NOT auto-overwrite reference hashes
  const baselineStore = JSON.parse(fs.readFileSync(path.resolve('src/security/integrity_baselines.json'), 'utf-8'));
  const storedReferenceHash = baselineStore['cfg-fraud-thresholds'].referenceHash;
  const currentTamperedHash = verifyThreshTamper.components.find(c => c.id === 'cfg-fraud-thresholds').currentHash;
  assert(storedReferenceHash !== currentTamperedHash, 'System did NOT auto-overwrite baseline reference hash upon mismatch');

  // Clean up and restore
  fs.writeFileSync(threshPath, origThresh);
  initializeIntegrityBaselines(true);

  // 5. Future Biometric Adapter Interface Readiness Test
  console.log('\n[TEST GROUP 6] Future Biometric Authentication Adapter Readiness');
  const faceRes = await defaultBiometricProvider.verifyFace('user-101', {});
  assert(faceRes.status === 'SUCCESS' && faceRes.factor === 'FACE_RECOGNITION', 'Face recognition adapter contract functional');
  const fpRes = await defaultBiometricProvider.verifyFingerprint('user-101', {});
  assert(fpRes.status === 'SUCCESS' && fpRes.factor === 'FINGERPRINT', 'Fingerprint adapter contract functional');
  const mfaRes = await defaultBiometricProvider.verifyMultiFactor('user-101', 'ESP32-99', {});
  assert(mfaRes.status === 'SUCCESS' && mfaRes.factor === 'MFA_ESP32_BIOMETRIC', 'Multi-factor ESP32 + Biometrics adapter contract functional');

  console.log('\n===========================================================');
  console.log(` TEST SUMMARY: ${passedTests} / ${totalTests} TESTS PASSED`);
  console.log('===========================================================');

  if (passedTests === totalTests) {
    console.log('🎉 ALL SYSTEM INTEGRITY MODULE TESTS PASSED PERFECTLY!\n');
    process.exit(0);
  } else {
    console.error('⚠️ SOME TESTS FAILED!\n');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
