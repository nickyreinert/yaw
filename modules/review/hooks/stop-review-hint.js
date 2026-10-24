// Stop (kind: comfort, ADR-0055): when reviewers are set to "suggest" and there is work that has not left the
// computer (uncommitted changes or unpushed commits), tell the user, not the model, once per session.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { yawHome } from '../../../core/hooks/dispatch.js';
import { triggers } from '../lib/cli.js';

const KEEP_SESSIONS = 50;

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}

function pendingWork(root) {
  if ((git(root, ['status', '--porcelain']) ?? '').trim()) return true;
  const ahead = git(root, ['rev-list', '--count', '@{upstream}..HEAD']);
  if (ahead !== null) return Number(ahead.trim()) > 0;
  return Number((git(root, ['rev-list', '--count', 'HEAD', '--not', '--remotes']) ?? '0').trim()) > 0;
}

export default function stopReviewHint(event, { root, env }) {
  const suggest = Object.entries(triggers(root)).filter(([, t]) => t === 'suggest').map(([k]) => k);
  if (suggest.length === 0 || !pendingWork(root)) return null;

  const state = join(yawHome(env), 'state', 'review-stop.json');
  let seen = {};
  try {
    seen = JSON.parse(readFileSync(state, 'utf8'));
  } catch { /* first hint */ }
  const key = event.sessionId ?? 'unknown';
  if (seen[key]) return null;
  try {
    mkdirSync(join(yawHome(env), 'state'), { recursive: true });
    const next = { ...seen, [key]: true };
    writeFileSync(`${state}.tmp`, JSON.stringify(Object.fromEntries(Object.entries(next).slice(-KEEP_SESSIONS))));
    renameSync(`${state}.tmp`, state);
  } catch { /* without the note the hint may repeat; it must not fail */ }

  return { systemMessage: `YAW review: work is ready; before you push, run ${suggest.map((k) => `just review ${k}`).join(', ')}` };
}
