const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function openDatabase() {
  if (config.databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });
  }
  const db = new DatabaseSync(config.databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'dosen', 'mahasiswa')),
      nim TEXT UNIQUE,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id),
      PRIMARY KEY (device_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lecturer_id TEXT NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS grades (
      id TEXT PRIMARY KEY,
      student_id TEXT NOT NULL REFERENCES users(id),
      class_id TEXT NOT NULL REFERENCES classes(id),
      score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
      status TEXT NOT NULL CHECK (status IN ('draft', 'final')),
      updated_at TEXT NOT NULL,
      UNIQUE (student_id, class_id)
    );
    CREATE TABLE IF NOT EXISTS transcripts (
      student_id TEXT NOT NULL REFERENCES users(id),
      class_id TEXT NOT NULL REFERENCES classes(id),
      score REAL NOT NULL,
      finalized_at TEXT NOT NULL,
      PRIMARY KEY (student_id, class_id)
    );
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      device_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      subject TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      device_id TEXT,
      decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
      reason TEXT NOT NULL
    );
  `);
  seedDatabase(db);
  return db;
}

function seedDatabase(db) {
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, username, full_name, role, nim, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const users = [
    ['admin-1', 'admin', 'Administrator Prodi', 'admin', null, 'Admin123!'],
    ['dosen-1', 'dosen1', 'Dosen Satu', 'dosen', null, 'Dosen123!'],
    ['dosen-2', 'dosen2', 'Dosen Dua', 'dosen', null, 'Dosen123!'],
    ['mhs-1', 'mhs1', 'Mahasiswa Satu', 'mahasiswa', '247006111201', 'Mhs123!'],
    ['mhs-2', 'mhs2', 'Mahasiswa Dua', 'mahasiswa', '247006111202', 'Mhs123!'],
    ['mhs-3', 'mhs3', 'Mahasiswa Tiga', 'mahasiswa', '247006111203', 'Mhs123!']
  ];
  for (const [id, username, fullName, role, nim, password] of users) {
    insertUser.run(id, username, fullName, role, nim, passwordHash(password));
  }

  const insertDevice = db.prepare('INSERT OR IGNORE INTO devices (device_id, user_id) VALUES (?, ?)');
  for (const [userId, deviceId] of [
    ['admin-1', 'device-admin-001'],
    ['dosen-1', 'device-dosen1-001'],
    ['dosen-2', 'device-dosen2-001'],
    ['mhs-1', 'device-mhs1-001'],
    ['mhs-2', 'device-mhs2-001'],
    ['mhs-3', 'device-mhs3-001']
  ]) insertDevice.run(deviceId, userId);

  const insertClass = db.prepare('INSERT OR IGNORE INTO classes (id, name, lecturer_id) VALUES (?, ?, ?)');
  insertClass.run('if101', 'Keamanan Informasi', 'dosen-1');
  insertClass.run('if202', 'Jaringan Komputer', 'dosen-2');

  const insertGrade = db.prepare(`
    INSERT OR IGNORE INTO grades (id, student_id, class_id, score, status, updated_at)
    VALUES (?, ?, ?, ?, 'draft', ?)
  `);
  const now = new Date().toISOString();
  insertGrade.run('grade-1', 'mhs-1', 'if101', 80, now);
  insertGrade.run('grade-2', 'mhs-2', 'if101', 90, now);
  insertGrade.run('grade-3', 'mhs-3', 'if202', 85, now);
}

function logDecision(db, { subject, endpoint, deviceId = null, decision, reason }) {
  db.prepare(`
    INSERT INTO audit_logs (timestamp, subject, endpoint, device_id, decision, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(new Date().toISOString(), subject || 'unknown', endpoint, deviceId, decision, reason);
}

module.exports = { logDecision, openDatabase, verifyPassword };
