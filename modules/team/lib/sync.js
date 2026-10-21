// Session start in a team (doc 14 §3, ADR-0031): fetch, the safe sync policy, and my issues and pull requests.
//
//   1. git fetch --prune origin (time-limited; a failure means offline)
//   2. fast-forward only when it is safe: the tree is clean, the branch is behind its upstream and not ahead.
//      Diverged or dirty: nothing happens, the user is told; the edit guard denies edits while diverged.
//      The default branch moved ahead of a feature branch: reported, never merged automatically.
//   3. my open issues (priority, estimate, milestone and due date), PRs waiting for my review, my PRs with failing
//      checks or requested changes: three gh reads at once, cached for 5 minutes in ~/.yaw/cache/; offline the
//      last result is shown with its time.
// Everything here is for the user (systemMessage, terminal). Nothing is model-visible except the active issue line
// of the session-issue hook, which reads the cache only.

import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { ghAsync } from '../../../core/lib/gh.js';
import { yawHome } from '../../../core/hooks/dispatch.js';
import { branchState, diverged, makeGit } from './git.js';

export const CACHE_MS = 5 * 60 * 1000;
const CACHE_MAX_BYTES = 512 * 1024;
const FETCH_MS = 4000;
const GH_MS = 4000;
const SHOW_ISSUES = 5;

// ----------------------------------------------------------------------------------- text

// One line of text from GitHub for display: no control or format characters, short.
export function clean(text, max = 80) {
  const s = String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const posInt = (n) => Number.isSafeInteger(n) && n > 0;
const labelValue = (labels, prefix) => (labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name)).find((n) => typeof n === 'string' && n.startsWith(prefix))?.slice(prefix.length);
const PRIORITY = /^P[0-3]$/;
const ESTIMATE = /^(XS|S|M|L|XL)$/;
const DATE = /^\d{4}-\d{2}-\d{2}/;

// ----------------------------------------------------------------------------------- GitHub reads

const FAILED = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

// gh output -> the cached shape (only numbers, short strings and dates; nothing is used as a path or command).
export function digest({ mine, reviews, authored }) {
  const issues = (Array.isArray(mine) ? mine : []).filter((i) => posInt(i?.number)).map((i) => {
    const priority = labelValue(i.labels, 'priority:');
    const estimate = labelValue(i.labels, 'estimate:');
    const due = typeof i.milestone?.dueOn === 'string' && DATE.test(i.milestone.dueOn) ? i.milestone.dueOn.slice(0, 10) : null;
    return {
      number: i.number,
      title: clean(i.title),
      priority: PRIORITY.test(priority ?? '') ? priority : null,
      estimate: ESTIMATE.test(estimate ?? '') ? estimate : null,
      milestone: i.milestone?.title ? clean(i.milestone.title, 40) : null,
      due,
    };
  });
  const rank = (i) => (i.priority ? Number(i.priority[1]) : 9);
  issues.sort((a, b) => rank(a) - rank(b) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.number - b.number);
  const review = (Array.isArray(reviews) ? reviews : []).filter((p) => posInt(p?.number)).map((p) => ({ number: p.number, title: clean(p.title, 60) }));
  const attention = [];
  for (const p of Array.isArray(authored) ? authored : []) {
    if (!posInt(p?.number)) continue;
    const why = [];
    if ((p.statusCheckRollup ?? []).some((c) => FAILED.has(String(c?.conclusion ?? c?.state ?? '').toUpperCase()))) why.push('checks failing');
    if (p.reviewDecision === 'CHANGES_REQUESTED') why.push('changes requested');
    if (why.length > 0) attention.push({ number: p.number, title: clean(p.title, 60), why });
  }
  return { issues, review, attention };
}

const parse = (text) => JSON.parse(String(text));

// Three reads at once; gh may be synchronous (tests) or return a promise (ghAsync).
export async function fetchGitHub(gh) {
  const [mine, reviews, authored] = await Promise.all([
    ['issue', 'list', '--assignee', '@me', '--state', 'open', '--limit', '50', '--json', 'number,title,labels,milestone'],
    ['pr', 'list', '--search', 'review-requested:@me', '--state', 'open', '--limit', '20', '--json', 'number,title'],
    ['pr', 'list', '--author', '@me', '--state', 'open', '--limit', '20', '--json', 'number,title,reviewDecision,statusCheckRollup'],
  ].map((args) => Promise.resolve().then(() => gh(args)).then(parse)));
  return digest({ mine, reviews, authored });
}

// ----------------------------------------------------------------------------------- cache

// ~/.yaw/cache/team-<hash of the project path>.json, or null when there is no usable home.
export function cacheFile(root, env) {
  const home = yawHome(env);
  if (!isAbsolute(home)) return null;
  return join(home, 'cache', `team-${createHash('sha256').update(String(root)).digest('hex').slice(0, 16)}.json`);
}

// A regular file (never a link), small, with the cached shape; anything else is no cache.
export function readCache(file) {
  if (!file) return null;
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); // a link is refused, not followed
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > CACHE_MAX_BYTES) return null;
    const buf = Buffer.alloc(st.size);
    readSync(fd, buf, 0, buf.length, 0);
    const value = JSON.parse(buf.toString('utf8'));
    if (value?.v !== 1 || typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))) return null;
    // Re-digest: a hand-edited cache file gets the same cleaning as a gh answer.
    const data = value.data ?? {};
    const again = digest({ mine: [], reviews: data.review, authored: [] });
    const issues = (Array.isArray(data.issues) ? data.issues : []).filter((i) => posInt(i?.number)).map((i) => ({
      number: i.number,
      title: clean(i.title),
      priority: PRIORITY.test(i.priority ?? '') ? i.priority : null,
      estimate: ESTIMATE.test(i.estimate ?? '') ? i.estimate : null,
      milestone: i.milestone ? clean(i.milestone, 40) : null,
      due: typeof i.due === 'string' && DATE.test(i.due) ? i.due.slice(0, 10) : null,
    }));
    const attention = (Array.isArray(data.attention) ? data.attention : []).filter((p) => posInt(p?.number)).map((p) => ({
      number: p.number,
      title: clean(p.title, 60),
      why: (Array.isArray(p.why) ? p.why : []).filter((w) => w === 'checks failing' || w === 'changes requested'),
    }));
    return { at: value.at, data: { issues, review: again.review, attention } };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Atomic write into a real directory (not a link): a new temporary file, then rename. Never throws.
export function writeCache(file, data, now) {
  if (!file) return;
  const dir = join(file, '..');
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (!lstatSync(dir).isDirectory()) return;
    try {
      if (!lstatSync(file).isFile()) return; // a link or something else in its place: leave it alone
    } catch { /* not there yet */ }
    writeFileSync(tmp, JSON.stringify({ v: 1, at: now.toISOString(), data }), { flag: 'wx', mode: 0o600 });
    renameSync(tmp, file);
  } catch {
    try {
      unlinkSync(tmp);
    } catch { /* nothing to clean */ }
  }
}

// ----------------------------------------------------------------------------------- sync

// The fetch must not hang on an SSH passphrase: BatchMode, unless the user configured their own ssh command.
function fetchEnv(git, env) {
  if (env.GIT_SSH_COMMAND || env.GIT_SSH || git(['config', '--get', 'core.sshCommand']).stdout !== '') return env;
  return { ...env, GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const time = (iso) => iso.replace('T', ' ').slice(0, 16);

// -> null outside a git work tree, else { lines, state, data, at, offline }
// io: { root, env, now, gh (optional; sync or async), fetchMs, ghMs }
export async function sessionStart({ root, env = process.env, now = new Date(), gh, fetchMs = FETCH_MS, ghMs = GH_MS }) {
  const git = makeGit(root, env);
  let state = branchState(root, git);
  if (!state) return null;
  const lines = [];
  const hasOrigin = git(['remote', 'get-url', 'origin']).status === 0;
  let fetched = false;
  if (hasOrigin) {
    fetched = makeGit(root, fetchEnv(git, env))(['fetch', '--prune', '--quiet', 'origin'], { timeoutMs: fetchMs }).status === 0;
    if (fetched) state = branchState(root, git);
  }

  // The sync policy (doc 14 §3.2).
  const where = state.branch === '' ? 'detached HEAD' : `${state.branch}${state.issue ? ` (#${state.issue})` : ''}`;
  const notes = [];
  if (!hasOrigin) notes.push('no remote "origin", nothing fetched');
  else if (!fetched) notes.push('offline: could not fetch origin');
  if (state.branch === '') {
    notes.push('no sync on a detached HEAD');
  } else if (state.upstream && state.behind > 0) {
    if (diverged(state)) {
      notes.push(`diverged from ${state.upstream} (${state.ahead} ahead, ${state.behind} behind): rebase or merge it yourself; agent edits are blocked until then`);
    } else if (state.dirty) {
      notes.push(`${plural(state.behind, 'commit')} behind ${state.upstream}; not pulled because the tree has changes`);
    } else {
      const ff = git(['merge', '--ff-only', '--quiet', state.upstream], { timeoutMs: 10000 });
      if (ff.status === 0) notes.push(`pulled ${plural(state.behind, 'commit')} from ${state.upstream} (fast-forward)`);
      else notes.push(`${plural(state.behind, 'commit')} behind ${state.upstream}; the fast-forward failed, pull it yourself`);
      state = branchState(root, git);
    }
  } else if (state.upstream) {
    notes.push(state.ahead > 0 ? `${plural(state.ahead, 'commit')} not pushed yet` : `up to date with ${state.upstream}`);
  }
  if (state.behindDefault > 0) notes.push(`${plural(state.behindDefault, 'commit')} behind ${state.defaultBranch}: rebase or merge when it suits you (never automatic)`);
  if (state.branch !== '' && (state.branch === state.defaultBranch || state.issue === null)) notes.push('edits need an issue branch: just task start <#>');
  lines.push(`YAW team · ${where}: ${notes.join('; ')}`);

  // GitHub, cached for 5 minutes; offline the last result is shown with its time.
  const file = cacheFile(root, env);
  let cached = readCache(file);
  let offline = null;
  const fresh = cached && now - new Date(cached.at) >= 0 && now - new Date(cached.at) < CACHE_MS;
  if (!fresh && hasOrigin) {
    if (!fetched) {
      offline = 'offline';
    } else {
      const call = gh ?? ((args) => ghAsync(args, { cwd: root, env, timeoutMs: ghMs }));
      try {
        const data = await fetchGitHub(call);
        writeCache(file, data, now);
        cached = { at: now.toISOString(), data };
      } catch (e) {
        offline = `GitHub not reachable (${clean(e?.message, 80)})`;
      }
    }
  }
  if (offline) lines.push(cached ? `${offline}, last sync ${time(cached.at)}` : `${offline}, no earlier sync to show`);
  if (cached) lines.push(...formatData(cached.data));
  return { lines, state, data: cached?.data ?? null, at: cached?.at ?? null, offline };
}

export function formatData({ issues, review, attention }) {
  const out = [];
  if (issues.length === 0) out.push('My open issues: none assigned');
  else {
    out.push(`My open issues (${issues.length}):`);
    for (const i of issues.slice(0, SHOW_ISSUES)) {
      const tags = [i.priority, i.estimate].filter(Boolean);
      const target = i.milestone ? ` · ${i.milestone}${i.due ? ` due ${i.due}` : ''}` : '';
      out.push(`  #${i.number}${tags.length ? ` [${tags.join(', ')}]` : ''} ${i.title}${target}`);
    }
    if (issues.length > SHOW_ISSUES) out.push(`  +${issues.length - SHOW_ISSUES} more (just task list)`);
  }
  if (review.length > 0) out.push(`Waiting for my review: ${review.map((p) => `#${p.number} ${p.title}`).join('; ')}`);
  if (attention.length > 0) out.push(`My pull requests: ${attention.map((p) => `#${p.number} ${p.title} (${p.why.join(', ')})`).join('; ')}`);
  return out;
}
