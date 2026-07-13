'use strict';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/moca.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'viewer')),
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      ip TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_ip TEXT,
      parameter_path TEXT NOT NULL,
      parameter_type TEXT,
      old_value TEXT,
      new_value TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'scheduled', 'applied', 'failed')) DEFAULT 'pending',
      scheduled_for TEXT,
      applied_at TEXT,
      error TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_pending_user ON pending_actions(user_id);
    CREATE INDEX IF NOT EXISTS idx_pending_device ON pending_actions(device_id);
    CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_actions(status);
  `);

  // Agregar columnas de perfil si no existen (para migraciones)
  const userTableInfo = database.pragma('table_info(users)');
  const hasNombre = userTableInfo.some(col => col.name === 'nombre');
  const hasApellido = userTableInfo.some(col => col.name === 'apellido');
  const hasCorreo = userTableInfo.some(col => col.name === 'correo');
  const hasTelefono = userTableInfo.some(col => col.name === 'telefono');

  if (!hasNombre) {
    database.exec('ALTER TABLE users ADD COLUMN nombre TEXT DEFAULT ""');
  }
  if (!hasApellido) {
    database.exec('ALTER TABLE users ADD COLUMN apellido TEXT DEFAULT ""');
  }
  if (!hasCorreo) {
    database.exec('ALTER TABLE users ADD COLUMN correo TEXT DEFAULT ""');
  }
  if (!hasTelefono) {
    database.exec('ALTER TABLE users ADD COLUMN telefono TEXT DEFAULT ""');
  }

  // Seed admin si no existe
  const adminExists = database.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin1234!';
    const hash = bcrypt.hashSync(adminPassword, 10);
    database.prepare(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
    ).run('admin', hash, 'admin');
    console.log('Usuario admin creado con la contraseña configurada en ADMIN_PASSWORD');
  }
}

module.exports = { getDb, initDb };
