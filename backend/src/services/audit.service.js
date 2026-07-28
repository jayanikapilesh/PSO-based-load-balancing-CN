import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const AUDIT_LOG_FILE = path.resolve('admin_audit_logs.json');

/**
 * Ensures the audit log file exists with valid structure.
 */
function ensureAuditFile() {
  if (!fs.existsSync(AUDIT_LOG_FILE)) {
    fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify([], null, 2));
  }
}

/**
 * Calculates SHA-256 hash for entry chaining to guarantee immutability.
 */
function calculateEntryHash(prevHash, entryData) {
  const content = `${prevHash}|${entryData.timestamp}|${entryData.adminId}|${entryData.action}|${entryData.affectedModule}|${entryData.result}`;
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Reads all audit log entries.
 */
export function getAuditLogs(filter = {}) {
  ensureAuditFile();
  try {
    const raw = fs.readFileSync(AUDIT_LOG_FILE, 'utf-8');
    let logs = JSON.parse(raw || '[]');

    if (filter.module) {
      logs = logs.filter(l => l.affectedModule && l.affectedModule.toLowerCase() === filter.module.toLowerCase());
    }
    if (filter.action) {
      logs = logs.filter(l => l.action && l.action.toLowerCase() === filter.action.toLowerCase());
    }
    if (filter.result) {
      logs = logs.filter(l => l.result && l.result.toLowerCase() === filter.result.toLowerCase());
    }
    if (filter.adminId) {
      logs = logs.filter(l => l.adminId && l.adminId.toLowerCase() === filter.adminId.toLowerCase());
    }

    return logs.reverse(); // Most recent first
  } catch (err) {
    console.error('Error reading audit logs:', err);
    return [];
  }
}

/**
 * Append-only recording of administrative and system integrity operations.
 */
export function recordAuditLog({
  adminId = 'SYSTEM',
  action,
  affectedModule = 'SystemIntegrity',
  previousValue = null,
  newValue = null,
  ipAddress = '127.0.0.1',
  result = 'SUCCESS',
  details = ''
}) {
  ensureAuditFile();
  try {
    const raw = fs.readFileSync(AUDIT_LOG_FILE, 'utf-8');
    const logs = JSON.parse(raw || '[]');

    const prevHash = logs.length > 0 ? logs[logs.length - 1].entryHash : 'GENESIS_BLOCK_00000000000000000000000000000000';
    const timestamp = new Date().toISOString();

    const entryData = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp,
      adminId,
      action,
      affectedModule,
      previousValue: previousValue !== null ? previousValue : 'N/A',
      newValue: newValue !== null ? newValue : 'N/A',
      ipAddress,
      result,
      details,
    };

    entryData.entryHash = calculateEntryHash(prevHash, entryData);

    logs.push(entryData);
    fs.writeFileSync(AUDIT_LOG_FILE, JSON.stringify(logs, null, 2));
    return entryData;
  } catch (err) {
    console.error('Failed to append to audit log:', err);
    throw new Error('Audit logging failure');
  }
}

/**
 * Validates the cryptographic hash chain of all audit logs.
 */
export function verifyAuditChainIntegrity() {
  ensureAuditFile();
  try {
    const raw = fs.readFileSync(AUDIT_LOG_FILE, 'utf-8');
    const logs = JSON.parse(raw || '[]');

    let prevHash = 'GENESIS_BLOCK_00000000000000000000000000000000';
    for (let i = 0; i < logs.length; i++) {
      const entry = logs[i];
      const expectedHash = calculateEntryHash(prevHash, entry);
      if (entry.entryHash !== expectedHash) {
        return {
          valid: false,
          corruptedIndex: i,
          corruptedEntryId: entry.id,
          reason: 'Cryptographic hash mismatch in audit chain'
        };
      }
      prevHash = entry.entryHash;
    }
    return { valid: true, count: logs.length };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
}
