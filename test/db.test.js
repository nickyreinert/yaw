import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIGRATIONS, SCHEMA_VERSION, loadSqlite, migrate, openYawDb } from '../core/lib/db.js';

const DB_MODULE = fileURLToPath(new URL('../core/lib/db.js', import.meta.url));

function tempDb(t) {
  const dir = mkdtempSync(join(tmpdir(), 'yaw-db-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, 'yaw.db');
}

test('phase-1 schema: migration table + session registry tables only (BD3)', (t) => {
  const db = openYawDb(tempDb(t));
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['schema_migrations', 'session_links', 'sessions']);
  const versions = db.prepare('SELECT version, name FROM schema_migrations').all().map((r) => ({ ...r }));
  assert.deepEqual(versions, [{ version: 1, name: 'session-registry' }, { version: 2, name: 'session-usage' }]);
  const columns = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  assert.deepEqual(columns.slice(-5), ['model', 'tokens_in', 'tokens_out', 'cost_usd', 'source']);
  assert.equal(SCHEMA_VERSION, MIGRATIONS.length);
  db.close();
});

test('registry stores a doc 12 §4 session with links; links cascade on delete', (t) => {
  const db = openYawDb(tempDb(t));
  db.prepare(`INSERT INTO sessions (id, agent, project, title, started, ended, branch, pr, resume, transcript)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'claude:5f2c', 'claude', '/home/user/projects/game', 'Invite flow: signaling server + token expiry',
    '2026-10-20T09:12:00Z', '2026-10-20T11:40:00Z', 'feat/T-012-invite-flow', '#41', 'claude --resume 5f2c', '/home/user/.claude/x.jsonl',
  );
  const link = db.prepare('INSERT INTO session_links (session_id, kind, ref) VALUES (?, ?, ?)');
  for (const [kind, ref] of [['task', 'T-012'], ['decision', 'ADR-0004'], ['commit', 'a1b2c3d'], ['file', 'server/index.js']]) {
    link.run('claude:5f2c', kind, ref);
  }
  assert.throws(() => link.run('claude:5f2c', 'note', 'x'), /CHECK constraint/);
  assert.throws(() => link.run('claude:missing', 'task', 'T-1'), /FOREIGN KEY/);
  const found = db.prepare(`SELECT s.id FROM sessions s JOIN session_links l ON l.session_id = s.id
                            WHERE l.kind = 'task' AND l.ref = ?`).all('T-012');
  assert.deepEqual(found.map((r) => r.id), ['claude:5f2c']);
  db.prepare('DELETE FROM sessions WHERE id = ?').run('claude:5f2c');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_links').get().n, 0);
  db.close();
});

test('migrations run once; reopening is a no-op; a newer database is refused', (t) => {
  const file = tempDb(t);
  openYawDb(file).close();
  const db = openYawDb(file);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, SCHEMA_VERSION);
  assert.equal(migrate(db), SCHEMA_VERSION);
  db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(99, 'future', '2030-01-01T00:00:00Z');
  assert.throws(() => migrate(db), /schema version 99/);
  db.close();
});

test('opening yaw.db prints nothing to stderr (no ExperimentalWarning, BD11)', (t) => {
  const file = tempDb(t);
  const script = `import { openYawDb } from ${JSON.stringify(DB_MODULE)}; openYawDb(${JSON.stringify(file)}).close(); process.emitWarning('still visible', 'UserWarning');`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /ExperimentalWarning|SQLite/);
  // Other warnings still reach stderr: only the SQLite warning is filtered.
  assert.match(r.stderr, /UserWarning: still visible/);
  assert.equal(r.stdout, '');
});

test('loadSqlite restores process.emitWarning', () => {
  const before = process.emitWarning;
  loadSqlite();
  assert.equal(process.emitWarning, before);
});

test('a phase-1 registry (version 1) gains the usage columns and keeps its rows (#174)', (t) => {
  const file = tempDb(t);
  const { DatabaseSync } = loadSqlite();
  const old = new DatabaseSync(file);
  old.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT');
  old.exec(MIGRATIONS[0].sql);
  old.prepare('INSERT INTO schema_migrations VALUES (1, ?, ?)').run(MIGRATIONS[0].name, '2026-10-01T00:00:00Z');
  old.prepare("INSERT INTO sessions (id, agent, project, started) VALUES ('claude:x1', 'claude', '/p', '2026-10-01T00:00:00Z')").run();
  old.close();
  const db = openYawDb(file);
  assert.deepEqual({ ...db.prepare('SELECT id, model, tokens_in, source FROM sessions').get() }, { id: 'claude:x1', model: null, tokens_in: null, source: null });
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 2);
  db.close();
});
