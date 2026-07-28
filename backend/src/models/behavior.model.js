import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Load Env variables — credentials stay in .env, never hardcoded
const pgConnectionString = process.env.DATABASE_URL;
let pool = null;
let useFallback = true;
const FALLBACK_FILE_PATH = path.resolve('behavior_profiles.json');

// Initialize Pool if connection string is provided
if (pgConnectionString) {
  try {
    pool = new Pool({
      connectionString: pgConnectionString,
      connectionTimeoutMillis: 5000, // Fail fast
    });
    console.log('PostgreSQL Pool initialized.');
  } catch (err) {
    console.error('Failed to initialize PostgreSQL pool, falling back to JSON storage:', err.message);
  }
} else {
  console.log('No DATABASE_URL provided. Using JSON file database fallback.');
}

// Check database connection and create tables
export async function initializeDatabase() {
  if (pool) {
    try {
      // Test connection
      const client = await pool.connect();
      console.log('Successfully connected to PostgreSQL!');
      client.release();

      // Table 1: Aggregate profile (one row per user — averaged biometric baseline)
      const createProfilesTable = `
        CREATE TABLE IF NOT EXISTS user_behavior_profiles (
          user_id           VARCHAR(255) PRIMARY KEY,
          average_hold_time   DOUBLE PRECISION NOT NULL,
          average_flight_time DOUBLE PRECISION NOT NULL,
          typing_speed        DOUBLE PRECISION NOT NULL,
          backspace_count     DOUBLE PRECISION NOT NULL,
          error_count         DOUBLE PRECISION NOT NULL,
          typing_duration     DOUBLE PRECISION NOT NULL,
          created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await pool.query(createProfilesTable);
      console.log('PostgreSQL table user_behavior_profiles verified/created.');

      // Table 2: Individual session history (one row per typing session — all 6 metrics)
      // This is what the friend requested: sessions array with all fields including
      // backspaceCount, errorCount, and typingDuration.
      const createSessionsTable = `
        CREATE TABLE IF NOT EXISTS user_behavior_sessions (
          id               SERIAL PRIMARY KEY,
          user_id          VARCHAR(255) NOT NULL REFERENCES user_behavior_profiles(user_id) ON DELETE CASCADE,
          hold_time        DOUBLE PRECISION NOT NULL,
          flight_time      DOUBLE PRECISION NOT NULL,
          typing_speed     DOUBLE PRECISION NOT NULL,
          backspace_count  DOUBLE PRECISION NOT NULL,
          error_count      DOUBLE PRECISION NOT NULL,
          typing_duration  DOUBLE PRECISION NOT NULL,
          session_type     VARCHAR(50) DEFAULT 'register',
          timestamp        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await pool.query(createSessionsTable);
      console.log('PostgreSQL table user_behavior_sessions verified/created.');

      useFallback = false;
    } catch (err) {
      console.error('PostgreSQL connection failed. Falling back to JSON database:', err.message);
      useFallback = true;
    }
  } else {
    useFallback = true;
  }

  if (useFallback) {
    console.log(`Using local JSON database at: ${FALLBACK_FILE_PATH}`);
    if (!fs.existsSync(FALLBACK_FILE_PATH)) {
      fs.writeFileSync(FALLBACK_FILE_PATH, JSON.stringify({}));
    }
  }
}

// ─── Fallback JSON Helpers ───────────────────────────────────────────────────

function readFallbackDb() {
  try {
    if (fs.existsSync(FALLBACK_FILE_PATH)) {
      const data = fs.readFileSync(FALLBACK_FILE_PATH, 'utf-8');
      return JSON.parse(data || '{}');
    }
  } catch (err) {
    console.error('Error reading JSON DB:', err);
  }
  return {};
}

function writeFallbackDb(data) {
  try {
    fs.writeFileSync(FALLBACK_FILE_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error writing JSON DB:', err);
  }
}

// ─── Session History ──────────────────────────────────────────────────────────

/**
 * Save one session entry for a user.
 * Sessions contain ALL 6 metrics (including backspaceCount, errorCount, typingDuration).
 * Uses parameterized queries ($1..$7) to prevent SQL injection.
 */
export async function saveSession(userId, features, sessionType = 'register') {
  const {
    averageHoldTime,
    averageFlightTime,
    typingSpeed,
    backspaceCount,
    errorCount,
    typingDuration,
  } = features;

  if (!useFallback && pool) {
    try {
      // Parameterized query — prevents SQL injection
      await pool.query(
        `INSERT INTO user_behavior_sessions
          (user_id, hold_time, flight_time, typing_speed, backspace_count, error_count, typing_duration, session_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, averageHoldTime, averageFlightTime, typingSpeed, backspaceCount, errorCount, typingDuration, sessionType]
      );
      return true;
    } catch (err) {
      console.error(`PostgreSQL saveSession error for user ${userId}:`, err.message);
    }
  }

  // JSON Fallback — append to sessions array
  const db = readFallbackDb();
  if (db[userId]) {
    if (!db[userId].sessions) db[userId].sessions = [];
    db[userId].sessions.push({
      timestamp: new Date().toISOString(),
      holdTime: averageHoldTime,
      flightTime: averageFlightTime,
      typingSpeed,
      backspaceCount,
      errorCount,
      typingDuration,
      sessionType,
    });
    writeFallbackDb(db);
  }
  return true;
}

/**
 * Retrieve session history for a user (most recent 20 sessions).
 * Returns all 6 metrics per session + timestamp.
 */
export async function getSessions(userId) {
  if (!useFallback && pool) {
    try {
      // Parameterized query — prevents SQL injection
      const res = await pool.query(
        `SELECT id, hold_time, flight_time, typing_speed, backspace_count, error_count,
                typing_duration, session_type, timestamp
         FROM user_behavior_sessions
         WHERE user_id = $1
         ORDER BY timestamp DESC
         LIMIT 20`,
        [userId]
      );
      return res.rows.map((row) => ({
        id: row.id,
        timestamp: row.timestamp,
        holdTime: row.hold_time,
        flightTime: row.flight_time,
        typingSpeed: row.typing_speed,
        backspaceCount: row.backspace_count,    // ← friend requested
        errorCount: row.error_count,             // ← friend requested
        typingDuration: row.typing_duration,     // ← friend requested
        sessionType: row.session_type,
      }));
    } catch (err) {
      console.error(`PostgreSQL getSessions error for user ${userId}:`, err.message);
    }
  }

  // JSON Fallback
  const db = readFallbackDb();
  return (db[userId]?.sessions || []).slice(-20).reverse();
}

// ─── Profile CRUD ─────────────────────────────────────────────────────────────

export async function getProfile(userId) {
  if (!useFallback && pool) {
    try {
      // Parameterized query — prevents SQL injection
      const res = await pool.query(
        'SELECT * FROM user_behavior_profiles WHERE user_id = $1',
        [userId]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          userId: row.user_id,
          averageHoldTime: row.average_hold_time,
          averageFlightTime: row.average_flight_time,
          typingSpeed: row.typing_speed,
          backspaceCount: row.backspace_count,
          errorCount: row.error_count,
          typingDuration: row.typing_duration,
        };
      }
      return null;
    } catch (err) {
      console.error(`PostgreSQL getProfile error for user ${userId}:`, err.message);
    }
  }

  // JSON Fallback
  const db = readFallbackDb();
  if (!db[userId]) return null;
  const u = db[userId];
  return {
    userId: u.userId,
    averageHoldTime: u.averageHoldTime,
    averageFlightTime: u.averageFlightTime,
    typingSpeed: u.typingSpeed,
    backspaceCount: u.backspaceCount,
    errorCount: u.errorCount,
    typingDuration: u.typingDuration,
  };
}

export async function saveProfile(userId, features) {
  const {
    averageHoldTime,
    averageFlightTime,
    typingSpeed,
    backspaceCount,
    errorCount,
    typingDuration,
  } = features;

  if (!useFallback && pool) {
    try {
      // Parameterized UPSERT — prevents SQL injection
      const upsertQuery = `
        INSERT INTO user_behavior_profiles (
          user_id, average_hold_time, average_flight_time, typing_speed,
          backspace_count, error_count, typing_duration, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) DO UPDATE SET
          average_hold_time   = EXCLUDED.average_hold_time,
          average_flight_time = EXCLUDED.average_flight_time,
          typing_speed        = EXCLUDED.typing_speed,
          backspace_count     = EXCLUDED.backspace_count,
          error_count         = EXCLUDED.error_count,
          typing_duration     = EXCLUDED.typing_duration,
          updated_at          = CURRENT_TIMESTAMP;
      `;
      await pool.query(upsertQuery, [
        userId,
        averageHoldTime,
        averageFlightTime,
        typingSpeed,
        backspaceCount,
        errorCount,
        typingDuration,
      ]);
      return { userId, ...features };
    } catch (err) {
      console.error(`PostgreSQL saveProfile error for user ${userId}:`, err.message);
    }
  }

  // JSON Fallback
  const db = readFallbackDb();
  const existing = db[userId] || {};
  db[userId] = {
    ...existing,
    userId,
    averageHoldTime,
    averageFlightTime,
    typingSpeed,
    backspaceCount,
    errorCount,
    typingDuration,
    updatedAt: new Date().toISOString(),
  };
  writeFallbackDb(db);
  return db[userId];
}

export function isUsingFallback() {
  return useFallback;
}

export async function deleteProfile(userId) {
  if (!useFallback && pool) {
    try {
      // Cascade delete also removes all sessions for this user (ON DELETE CASCADE)
      // Parameterized query — prevents SQL injection
      await pool.query('DELETE FROM user_behavior_profiles WHERE user_id = $1', [userId]);
      return true;
    } catch (err) {
      console.error(`PostgreSQL deleteProfile error for user ${userId}:`, err.message);
    }
  }

  // JSON Fallback
  const db = readFallbackDb();
  if (db[userId]) {
    delete db[userId];
    writeFallbackDb(db);
    return true;
  }
  return false;
}
