import crypto from 'crypto';
import { recordAuditLog } from '../services/audit.service.js';
import { isSystemLocked } from '../services/integrity.service.js';

// Secret key for signing admin JWTs (or HMAC fallback)
const JWT_SECRET = process.env.JWT_SECRET || 'SUPER_SECURE_FRAUD_PLATFORM_ADMIN_JWT_SECRET_2026';

/**
 * Creates a signed JWT token for an admin user.
 */
export function generateAdminJwt(adminId, role = 'admin') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: adminId,
    role,
    iss: 'fraud-prevention-platform-admin',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (8 * 3600) // 8 hour expiration
  })).toString('base64url');

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Verifies a JWT token and extracts decoded payload.
 */
export function verifyJwtToken(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(`${header}.${payload}`)
      .digest('base64url');

    if (signature !== expectedSig) return null;

    const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (decodedPayload.exp && decodedPayload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return decodedPayload;
  } catch (err) {
    return null;
  }
}

/**
 * Express middleware to authenticate JWT and enforce 'admin' role.
 */
export function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    recordAuditLog({
      adminId: 'ANONYMOUS',
      action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      affectedModule: 'Administrative API Security',
      ipAddress,
      result: 'FAILURE',
      details: `Missing or invalid Bearer token for route ${req.originalUrl}`
    });
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Administrative authentication token is missing or malformed.'
    });
  }

  const token = authHeader.split(' ')[1];
  const payload = verifyJwtToken(token);

  if (!payload || payload.role !== 'admin') {
    recordAuditLog({
      adminId: payload?.sub || 'INVALID_TOKEN',
      action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
      affectedModule: 'Administrative API Security',
      ipAddress,
      result: 'FAILURE',
      details: `Failed administrative token validation for route ${req.originalUrl}`
    });
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid administrative token or insufficient role permissions.'
    });
  }

  req.admin = payload;
  next();
}

/**
 * Express middleware to prevent administrative configuration updates when System Integrity is COMPROMISED.
 */
export function checkAdminLock(req, res, next) {
  if (isSystemLocked()) {
    const adminId = req.admin?.sub || 'ADMIN';
    const ipAddress = req.ip || '127.0.0.1';

    recordAuditLog({
      adminId,
      action: 'MUTATION_BLOCKED_DUE_TO_INTEGRITY_COMPROMISE',
      affectedModule: req.originalUrl,
      ipAddress,
      result: 'FAILURE',
      details: 'Attempted administrative configuration modification while System Integrity is COMPROMISED.'
    });

    return res.status(423).json({
      error: 'Locked',
      message: 'Administrative modifications are LOCKED because System Integrity tampering was detected. Please verify system integrity before proceeding.'
    });
  }
  next();
}
