// ~/.yaw/yaw.db: phase-1 schema (session registry only, BD3, ADR-0018).
// Uses node:sqlite (Node >= 22.13, no flag); its ExperimentalWarning is suppressed (BD11).

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let sqlite;

// Load node:sqlite without printing its ExperimentalWarning. Other warnings pass through.
export function loadSqlite() {
  if (sqlite) return sqlite;
  const original = process.emitWarning;
  process.emitWarning = function emitWarning(warning, ...args) {
    const type = typeof args[0] === 'string' ? args[0] : args[0]?.type ?? warning?.name;
    const message = typeof warning === 'string' ? warning : warning?.message;
    if (type === 'ExperimentalWarning' && /SQLite/i.test(String(message))) return;
    return original.call(process, warning, ...args);
  };
  try {
    sqlite = require('node:sqlite');
  } finally {
    process.emitWarning = original;
  }
  return sqlite;
}

export const MIGRATIONS = [
  {
    version: 1,
    name: 'session-registry',
    sql: `
      CREATE TABLE sessions (
        id         TEXT PRIMARY KEY,  -- '<agent>:<agent session id>'
        agent      TEXT NOT NULL,     -- claude | codex | copilot
        project    TEXT NOT NULL,     -- absolute path of the project root
        title      TEXT,
        started    TEXT NOT NULL,     -- ISO 8601, UTC
        ended      TEXT,
        branch     TEXT,
        pr         TEXT,              -- '#41'
        resume     TEXT,              -- command that resumes the session
        transcript TEXT               -- local path to the transcript, never its content
      ) STRICT;
      CREATE INDEX sessions_by_project ON sessions (project, started);
      CREATE TABLE session_links (
        session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('task', 'decision', 'commit', 'file')),
        ref        TEXT NOT NULL,     -- 'T-012' | '#34' | 'ADR-0004' | 'a1b2c3d' | 'src/x.js'
        PRIMARY KEY (session_id, kind, ref)
      ) STRICT;
      CREATE INDEX session_links_by_ref ON session_links (kind, ref);
    `,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`);
  const current = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;
  if (current > SCHEMA_VERSION) {
    throw new Error(`yaw.db has schema version ${current}, this kit knows up to ${SCHEMA_VERSION}; run yaw self-update`);
  }
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return SCHEMA_VERSION;
}

export function openYawDb(file) {
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}
