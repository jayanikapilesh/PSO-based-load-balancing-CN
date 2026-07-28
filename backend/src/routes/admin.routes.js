import express from 'express';
import {
  adminLogin,
  getSystemIntegrityStatus,
  getSystemIntegrityReport,
  runManualIntegrityVerification,
  getAdminAuditLogs,
  recertifyComponentBaseline,
  updateFraudThresholds,
  updateTrustEngineConfig,
  updateRiskClassificationConfig,
  updateEmergencyPolicies,
  updateTemporaryLimits,
  updateDriftMonitoringConfig,
  injectFailureSimulation,
  restoreBaselines,
  testPredictionWithIntegrityCheck,
  testBiometricAdapter
} from '../controllers/admin.controller.js';
import { authenticateAdmin, checkAdminLock } from '../middleware/auth.middleware.js';

const router = express.Router();

// ─── Public Admin Endpoints ───
router.post('/auth/login', adminLogin);
router.get('/integrity/status', getSystemIntegrityStatus);
router.get('/integrity/report', getSystemIntegrityReport);

// ─── Protected Administrative Endpoints (JWT + RBAC Required) ───
router.get('/audit/logs', authenticateAdmin, getAdminAuditLogs);
router.post('/integrity/verify', authenticateAdmin, runManualIntegrityVerification);
router.post('/integrity/recertify', authenticateAdmin, recertifyComponentBaseline);

// ─── Protected Configuration Modification Endpoints (JWT + RBAC + Integrity Lock Check) ───
router.post('/config/thresholds', authenticateAdmin, checkAdminLock, updateFraudThresholds);
router.post('/config/trust-score', authenticateAdmin, checkAdminLock, updateTrustEngineConfig);
router.post('/config/risk-classification', authenticateAdmin, checkAdminLock, updateRiskClassificationConfig);
router.post('/config/emergency-policy', authenticateAdmin, checkAdminLock, updateEmergencyPolicies);
router.post('/config/temporary-limits', authenticateAdmin, checkAdminLock, updateTemporaryLimits);
router.post('/config/drift-monitoring', authenticateAdmin, checkAdminLock, updateDriftMonitoringConfig);

// ─── Security Testing & Simulation Endpoints ───
router.post('/test/inject-failure', injectFailureSimulation);
router.post('/test/restore-baselines', restoreBaselines);
router.post('/test/predict', testPredictionWithIntegrityCheck);
router.post('/test/biometric-stub', testBiometricAdapter);

export default router;
