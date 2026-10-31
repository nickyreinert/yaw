import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmp as makeTmp } from './helpers/fixtures.js';
import { join } from 'node:path';
import { findSessions, probeSource } from '../modules/sessions/lib/import.js';
import { claudeFolder } from '../modules/sessions/lib/import.js';
import { effectiveSources, saveSources, sourcesData } from '../core/lib/session-sources.js';
import { readTurns } from '../core/lib/session-analysis.js';

const tmp = () => realpathSync(makeTmp('yaw-sources-'));
const sha = (t) => createHash('sha256').update(t).digest('hex');
const chat = { sessionId: 'abc-123', projectHash: 'x', startTime: '2026-10-01T10:00:00Z', lastUpdated: '2026-10-01T10:20:00Z', messages: [
  { id: '1', timestamp: '2026-10-01T10:00:05Z', type: 'user', content: 'hello there' },
  { id: '2', timestamp: '2026-10-01T10:00:09Z', type: 'gemini', content: 'hi', model: 'gemini-2.5-pro', tokens: { input: 100, output: 20, cached: 10, thoughts: 5 } },
  { id: '3', timestamp: '2026-10-01T10:00:10Z', type: 'info', content: 'note' }] };

test('Gemini CLI chats are read from a chosen folder, matched to their project by hash or .project_root', async () => {
  const home = tmp(), project = join(home, 'work', 'app'), base = join(home, 'gem');
  mkdirSync(project, { recursive: true });
  const hashed = join(base, 'tmp', sha(project), 'chats'); mkdirSync(hashed, { recursive: true });
  writeFileSync(join(hashed, 'session-a.json'), JSON.stringify(chat));
  const named = join(base, 'tmp', 'other', 'chats'); mkdirSync(named, { recursive: true });
  writeFileSync(join(base, 'tmp', 'other', '.project_root'), `${join(home, 'work', 'second')}\n`);
  writeFileSync(join(named, 'session-b.json'), JSON.stringify({ ...chat, sessionId: 'def-456' }));
  const sources = [{ agent: 'gemini', path: base }];
  const mine = await findSessions({ env: { HOME: home }, root: project, sources });
  assert.equal(mine.length, 1);
  assert.deepEqual([mine[0].agent, mine[0].native, mine[0].model, mine[0].tokensIn, mine[0].tokensOut, mine[0].ended], ['gemini', 'abc-123', 'gemini-2.5-pro', 110, 25, '2026-10-01T10:20:00.000Z']);
  // all projects: the .project_root folder is found, the hashed one only when its project is known
  assert.equal((await findSessions({ env: { HOME: home }, root: project, allProjects: true, sources })).length, 1);
  assert.equal((await findSessions({ env: { HOME: home }, root: project, allProjects: true, sources, known: [project] })).length, 2);
  assert.equal(probeSource({ agent: 'gemini', path: base }), 2);
  const turns = await readTurns(join(hashed, 'session-a.json'), 'gemini');
  assert.deepEqual(turns.messages.map((m) => m.role), ['user', 'assistant']);
});

test('a custom Claude folder is read; the same session in two folders counts once; no folders, no sessions', async () => {
  const home = tmp(), project = join(home, 'p'); mkdirSync(project);
  const line = (o) => `${JSON.stringify(o)}\n`;
  const write = (base) => {
    const dir = join(base, 'projects', claudeFolder(project)); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 's.jsonl'), line({ type: 'user', sessionId: 'sess-1', cwd: project, timestamp: '2026-10-01T10:00:00Z' }) + line({ type: 'assistant', sessionId: 'sess-1', timestamp: '2026-10-01T10:01:00Z', message: { id: 'm1', model: 'opus', usage: { input_tokens: 3, output_tokens: 4 } } }));
  };
  write(join(home, 'one')); write(join(home, 'two'));
  const both = [{ agent: 'claude', path: join(home, 'one') }, { agent: 'claude', path: join(home, 'two') }];
  assert.equal((await findSessions({ env: { HOME: home }, root: project, sources: both })).length, 1);
  assert.equal((await findSessions({ env: { HOME: home }, root: project, sources: [] })).length, 0);
  assert.equal((await findSessions({ env: { HOME: home }, root: project })).length, 0);
});

test('saved session folders: defaults first, validated edits, disabled folders skipped, reset', () => {
  const home = tmp(), env = { HOME: home };
  assert.deepEqual(effectiveSources(env).map((s) => s.agent), ['claude', 'codex', 'copilot', 'gemini']);
  assert.equal(sourcesData(env).custom, false);
  const out = saveSources(env, [{ agent: 'claude', path: `${home}/a/../x` }, { agent: 'claude', path: `${home}/x` }, { agent: 'gemini', path: `${home}/g`, enabled: false }]);
  assert.deepEqual(out.sources.map((s) => [s.agent, s.path, s.enabled]), [['claude', `${home}/x`, true], ['gemini', `${home}/g`, false]]);
  assert.deepEqual(effectiveSources(env), [{ agent: 'claude', path: `${home}/x` }]);
  assert.throws(() => saveSources(env, [{ agent: 'claude', path: 'relative/dir' }]), /absolute/);
  assert.throws(() => saveSources(env, [{ agent: 'cursor', path: `${home}/c` }]), /Format/);
  assert.throws(() => saveSources(env, 'nope'), /at most/);
});
