'use strict';

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let db;

function getDbPath() {
  // Lazy require to allow env to be loaded first (dotenv in server.js)
  const { getEnv } = require('./env');
  return getEnv().dbPath;
}

function getDb() {
  if (!db) {
    const dbPath = getDbPath();
    // Ensure directory exists (for host volume ./data/gateway:/app/data)
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      active INTEGER DEFAULT 1,
      last_used TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      serial TEXT NOT NULL,
      manufacturer TEXT,
      model TEXT,
      profile TEXT NOT NULL,
      software_version TEXT,
      last_inform TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_devices_serial ON devices(serial);

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial TEXT NOT NULL,
      device_id TEXT NOT NULL,
      profile TEXT NOT NULL,
      action TEXT NOT NULL,
      payload_canonical TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','applied','failed','expired')),
      error TEXT,
      result TEXT,
      api_key_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL DEFAULT (datetime('now', '+24 hours')),
      attempt_count INTEGER DEFAULT 0,
      max_attempts INTEGER,
      applied_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_serial ON tasks(serial);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_name TEXT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      ip TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
}

function seedApiKeys() {
  const database = getDb();
  const count = database.prepare('SELECT COUNT(*) as c FROM api_keys').get().c;
  if (count > 0) return;

  // Seed from env if provided, otherwise generate a dev key
  const rawKey = process.env.GATEWAY_SEED_API_KEY || null;
  let keyToHash;
  let keyName = 'sistema-gestion';

  if (rawKey) {
    keyToHash = rawKey;
    keyName = process.env.GATEWAY_SEED_API_KEY_NAME || 'sistema-gestion';
  } else {
    // Dev-only: generate ephemeral key and log it once
    keyToHash = crypto.randomBytes(32).toString('hex');
    console.log('[gateway] GATEWAY_SEED_API_KEY no configurada — key de desarrollo generada:');
    console.log(`[gateway]   name: ${keyName}`);
    console.log(`[gateway]   key:  ${keyToHash}`);
    console.log('[gateway]   (guardá esta key, solo se muestra una vez; en producción usá GATEWAY_SEED_API_KEY)');
  }

  const hash = crypto.createHash('sha256').update(keyToHash).digest('hex');
  database.prepare('INSERT INTO api_keys (name, key_hash) VALUES (?, ?)').run(keyName, hash);
  if (rawKey) {
    console.log(`[gateway] api_keys seeded: ${keyName}`);
  }
}

module.exports = { getDb, initDb, seedApiKeys };
