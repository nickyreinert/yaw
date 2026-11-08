import { interviewShell } from './interview-shell.js';
// Local dashboard (#172), with explicit authenticated workspace actions and saved session analytics.
// The form server's handshake, cookie, Host/Origin and CSRF checks also protect workspace actions.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readManifest } from '../render/manifest.js';
import { enabledModules, readAnswers } from '../render/project.js';
import { sessionRows } from './session-rows.js';
import { projectLanguage } from './project-language.js';
import { readProjectFile } from '../render/files.js';
import { mergeHistory } from './local-history.js';
import { readAnalysis } from '../lib/session-analysis.js';
import { readSavings } from '../lib/savings.js';
import { sessionKey, syncedSessions, syncedTasks } from '../lib/data-sync.js';
import { createWorkspaceApi } from './workspace-api.js';
import { knowledgeData } from './knowledge.js';
import { parseTasks, tasksMode } from '../lib/tasks.js';
import { startFormServer } from './form-server.js';
import { realRoot } from '../../modules/sessions/lib/registry.js';
import { projectSwitcher } from './projects.js';

const asset = (name, type) => [`/${name}`, [type, readFileSync(new URL(`./assets/${name}`, import.meta.url))]];
const DASHBOARD_ASSETS = new Map([
  ['/interview-shell.html', ['text/html; charset=utf-8', Buffer.from(interviewShell())]],
  ['/interview-view.js', ['text/javascript; charset=utf-8', readFileSync(new URL('./assets/interview-view.js', import.meta.url))]],
  ['/interview/suggest.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../interview/suggest.js', import.meta.url))]],
  ['/interview/depth.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../interview/depth.js', import.meta.url))]],
  ['/interview/module-groups.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../interview/module-groups.js', import.meta.url))]],
  ['/interview/policy.js', ['text/javascript; charset=utf-8', readFileSync(new URL('../interview/policy.js', import.meta.url))]],
  asset('dashboard.js', 'text/javascript; charset=utf-8'),
  asset('yaw-theme.css', 'text/css; charset=utf-8'),
  asset('app.css', 'text/css; charset=utf-8'),
  asset('workspace.js', 'text/javascript; charset=utf-8'),
  asset('settings-view.js', 'text/javascript; charset=utf-8'),
  asset('overview-metrics.js', 'text/javascript; charset=utf-8'),
  asset('analytics-filters.js', 'text/javascript; charset=utf-8'),
  asset('tool-output.js', 'text/javascript; charset=utf-8'),
  asset('savings.js', 'text/javascript; charset=utf-8'),
  asset('global-view.js', 'text/javascript; charset=utf-8'),
  asset('insights-view.js', 'text/javascript; charset=utf-8'),
  asset('insights-model.js', 'text/javascript; charset=utf-8'),
  asset('chat-services.js', 'text/javascript; charset=utf-8'),
  asset('global-settings-view.js', 'text/javascript; charset=utf-8'),
  asset('ui-state.js', 'text/javascript; charset=utf-8'),
  asset('setup-cards.js', 'text/javascript; charset=utf-8'),
  asset('search.js', 'text/javascript; charset=utf-8'),
  asset('pagination.js', 'text/javascript; charset=utf-8'),
  asset('folder-picker.js', 'text/javascript; charset=utf-8'),
  asset('review-step.js', 'text/javascript; charset=utf-8'),
  asset('project-tree.js', 'text/javascript; charset=utf-8'),
  asset('planning-handoff.js', 'text/javascript; charset=utf-8'),
  asset('plan-card.js', 'text/javascript; charset=utf-8'),
  asset('review-prompts-view.js', 'text/javascript; charset=utf-8'),
  asset('yaw-shark.svg', 'image/svg+xml'),
]);
const page = (csrf) => readFileSync(new URL('./assets/dashboard.html', import.meta.url), 'utf8').replace('YAW_CSRF', csrf);

const DAY_MS = 24 * 60 * 60 * 1000;
const minutes = (row) => {
  const start = Date.parse(row.started);
  const end = Date.parse(row.ended ?? row.started);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 60000) : 0;
};

// Each section reports its own problem, so one broken file never hides the others.
function section(fn) {
  try {
    return fn();
  } catch (e) {
    return { error: String(e.message ?? e).split('\n')[0].slice(0, 300) };
  }
}

function projectSection(root) {
  const manifest = readManifest(root);
  if (!manifest) return { name: basename(root), root, canonicalRoot: realRoot(root), initialized: false, modules: [], profiles: [], agents: [] };
  const doc = readAnswers(root) ?? {};
  const answers = doc.answers ?? {};
  const modules = enabledModules(manifest);
  return {
    name: basename(root),
    initialized: true,
    root,
    canonicalRoot: realRoot(root),
    kit: manifest.kit,
    mode: doc.mode ?? null,
    idea: typeof answers['idea.text'] === 'string' ? answers['idea.text'] : '',
    agents: answers['user.agents'] ?? [],
    profiles: doc.proposal?.profiles ?? [],
    modules,
    tasks: modules.includes('tasks') ? tasksMode(answers, { teamModule: modules.includes('team') }) : null,
  };
}

export function tasksSection(root) {
  const content = readProjectFile(root, 'TASKS.md');
  if (!content) return { available: false };
  if (content.length > 1024 * 1024) throw new Error('Task ledger exceeds 1 MiB');
  const ledger = parseTasks(content.toString('utf8'), { file: 'TASKS.md' });
  return {
    available: true,
    readOnly: ledger.readOnly,
    active: ledger.active.map(({ id, issue, title, status, progress }) => ({ id, issue, title, status, progress })),
    backlog: ledger.backlog.map(({ id, issue, title, note }) => ({ id, issue, title, note })),
  };
}

async function decisionsSection(root, kitRoot) {
  if (!existsSync(join(root, '.decisions'))) return { available: false };
  const { readIndex } = await import(pathToFileURL(join(kitRoot, 'modules', 'decisions', 'lib', 'journal.js')).href);
  const index = readIndex(root);
  return {
    available: true,
    entries: index.entries.map(({ id, summary, status, importance, date, category }) => ({ id, summary, status, importance, date, category })),
  };
}

// Imported sessions (#174) carry token counts; hook-recorded ones count 0.
const tokensOf = (r) => Number(r.tokens_in ?? 0) + Number(r.tokens_out ?? 0);

// Registry plus saved scan, merged. A missing registry is reported, never created by the dashboard.
async function history(kitRoot, env) {
  const registry = await import(pathToFileURL(join(kitRoot, 'modules', 'sessions', 'lib', 'registry.js')).href);
  const stored = existsSync(registry.registryFile(env)) ? registry.withRegistry(env, (db) => ({
    rows: db.prepare('SELECT id, agent, project, title, started, ended, branch, pr, model, tokens_in, tokens_out, cost_usd, source FROM sessions ORDER BY started DESC').all(),
    links: db.prepare('SELECT session_id, kind, COUNT(*) AS n FROM session_links GROUP BY session_id, kind').all(),
  })) : null;
  const saved = readAnalysis(env);
  if (!stored && !saved.collected) return null;
  const rows = mergeHistory(stored?.rows ?? [], saved.rows);
  // No registry strings become markup or commands.
  for (const row of rows) for (const key of ['title', 'branch', 'model']) row[key] = registry.clean(row[key]);
  return { registry, stored, saved, rows };
}

// Sessions from other synced devices as registry-like rows. Their identity is the hash; they have no title, branch
// or project path. Keep a synthetic project only as a grouping key and expose the originating device separately.
function syncedRows(env, own) {
  let list = [];
  try { list = syncedSessions(env); } catch { return []; }
  const iso = (ms) => Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  return list.filter((s) => !own.has(s.key)).map((s) => ({
    id: `synced:${s.key.slice(0, 24)}`, agent: s.agent || 'Unknown', project: `synced · ${s.device}`, model: s.model || 'Unknown', title: '', branch: '', source: 'synced',
    deviceId: s.deviceId, deviceName: s.device,
    started: iso(s.started), ended: s.started != null && s.minutes != null ? iso(s.started + s.minutes * 60000) : null,
    tokens_in: s.tokens_in, tokens_out: s.tokens_out, cost_usd: s.cost_usd,
    metrics: s.prompts == null && s.answers == null ? null : { prompts: s.prompts, answers: s.answers, promptChars: s.promptChars, answerChars: s.answerChars,
      medianAnswerChars: s.medianAnswerChars, p95AnswerChars: s.p95AnswerChars, medianResponseMs: s.medianResponseMs, p95ResponseMs: s.p95ResponseMs },
  }));
}

function withProjectLanguages(rows) {
  const languages = new Map();
  for (const project of new Set(rows.map((r) => r.project).filter((p) => typeof p === 'string' && p.startsWith('/')))) {
    const result = section(() => projectLanguage(project));
    languages.set(project, typeof result === 'string' ? result : 'Unknown');
  }
  return rows.map((row) => ({ ...row, language: languages.get(row.project) ?? 'Unknown' }));
}

// Every known session as compact rows for the Sessions and Global views; the browser filters and charts them.
export async function sessionsData({ root, kitRoot, env, projects }) {
  const h = await history(kitRoot, env);
  const current = realRoot(root);
  const saved = h?.saved ?? readAnalysis(env);
  const live = section(() => tasksSection(root));
  let other = [];
  try { other = syncedTasks(env).map((t) => ({ project: `synced · ${t.device} · ${t.name}`, available: true, active: t.active.map((i) => ({ ...i, id: i.id ?? '—' })), backlog: t.backlog })); } catch { /* snapshots are optional */ }
  const tasks = [...(saved.tasks ?? []).filter((t) => t.project !== current), ...(live.available ? [{ project: current, ...live }] : []), ...other];
  const known = projects ? projects.list().projects.map((p) => p.root) : [];
  const synced = syncedRows(env, new Set((h?.rows ?? []).map((r) => sessionKey(r.id))));
  if (!h && !synced.length) return { available: false, current, tasks, projects: known, history: { collected: saved.collected ?? null } };
  const savings = section(() => readSavings(env));
  const compressed = new Set(savings.sessions ?? []);
  return {
    available: true, current, tasks, projects: known,
    history: { local: Boolean(h?.saved.collected), collected: h?.saved.collected ?? null, registered: h?.stored?.rows.length ?? 0, synced: synced.length },
    savings: savings.entries ?? [],
    ...sessionRows(withProjectLanguages([...(h?.rows ?? []), ...synced]).map((r) => compressed.has(r.id) ? { ...r, compressed: true } : r)),
  };
}

// Session stats for the Overview.
export async function sessionsSection(root, kitRoot, env, now = new Date()) {
  const h = await history(kitRoot, env);
  if (!h) return { available: false };
  const { registry, stored, saved, rows } = h;
  const project = registry.realRoot(root);
    const links = stored?.links ?? [];
    const linkCount = new Map();
    for (const l of links) linkCount.set(`${l.session_id}\u0000${l.kind}`, Number(l.n));
    const summarize = (list) => {
      const byAgent = {};
      let total = 0;
      let tokens = 0;
      let cost = 0;
      let usageSessions = 0, costSessions = 0, timedSessions = 0;
      for (const r of list) {
        const m = minutes(r);
        if (r.tokens_in != null || r.tokens_out != null) usageSessions++;
        if (r.cost_usd != null) costSessions++;
        if (r.ended && Number.isFinite(Date.parse(r.ended)) && Date.parse(r.ended) >= Date.parse(r.started)) timedSessions++;
        total += m;
        tokens += tokensOf(r);
        cost += Number(r.cost_usd ?? 0);
        byAgent[r.agent] ??= { sessions: 0, minutes: 0 };
        byAgent[r.agent].sessions += 1;
        byAgent[r.agent].minutes += m;
        if (tokensOf(r) > 0) byAgent[r.agent].tokens = (byAgent[r.agent].tokens ?? 0) + tokensOf(r);
      }
      const since = now.getTime() - 30 * DAY_MS;
      const days = {};
      for (const r of list) {
        const t = Date.parse(r.started);
        if (Number.isFinite(t) && t >= since) {
          const day = new Date(t).toISOString().slice(0, 10);
          days[day] = (days[day] ?? 0) + 1;
        }
      }
      return { sessions: list.length, usageSessions, costSessions, timedSessions, minutes: total, tokens, costUsd: Math.round(cost * 100) / 100, byAgent, last30Days: days };
    };
    const mine = rows.filter((r) => r.project === project);
    const projects = {};
    for (const r of rows) {
      projects[r.project] ??= { project: r.project, sessions: 0, minutes: 0, last: r.started };
      projects[r.project].sessions += 1;
      projects[r.project].minutes += minutes(r);
      projects[r.project].tokens = (projects[r.project].tokens ?? 0) + tokensOf(r);
      if (r.started > projects[r.project].last) projects[r.project].last = r.started;
    }
    return {
      available: true,
      history: { local: Boolean(saved.collected), collected: saved.collected, registered: stored?.rows.length ?? 0 },
      project: {
        ...summarize(mine),
        recent: mine.slice(0, 50).map((r) => ({
          id: r.id, agent: r.agent, title: registry.clean(r.title), started: r.started, ended: r.ended,
          minutes: minutes(r), branch: registry.clean(r.branch), pr: r.pr, model: registry.clean(r.model), tokens: tokensOf(r),
          commits: linkCount.get(`${r.id}\u0000commit`) ?? 0, tasks: linkCount.get(`${r.id}\u0000task`) ?? 0,
        })),
      },
      all: { ...summarize(rows), projectCount: Object.keys(projects).length, projects: Object.values(projects).sort((a, b) => b.sessions - a.sessions).slice(0, 50) },
    };
}

export async function dashboardData({ root, kitRoot, env, now }) {
  const project = section(() => projectSection(root));
  const [decisions, sessions] = await Promise.all([
    decisionsSection(root, kitRoot).catch((e) => ({ error: String(e.message ?? e).split('\n')[0] })),
    sessionsSection(root, kitRoot, env, now).catch((e) => ({ error: String(e.message ?? e).split('\n')[0] })),
  ]);
  const saved = section(() => readAnalysis(env));
  return { project, tasks: section(() => tasksSection(root)), globalTasks: saved.tasks ?? [], decisions, sessions, generated: (now ?? new Date()).toISOString() };
}

// One server serves every known YAW project: `root` is only the default; each request may name another workspace.
export async function startDashboard({ root, kitRoot, env, port, signals, onClose, idleMs, controlToken }) {
  const projects = projectSwitcher({ env, root });
  const api = createWorkspaceApi({ kitRoot, env, projects });
  const at = (params) => projects.resolve(params.get('workspace'));
  return startFormServer({
    port, signals, onClose, idleMs, controlToken, page, assets: DASHBOARD_ASSETS, api,
    onOpen: (input) => { if (input?.root !== undefined) projects.open(input.root); },
    get: {
      '/api/projects': () => projects.list(),
      '/api/dashboard': (params) => dashboardData({ root: at(params), kitRoot, env }),
      '/api/knowledge': (params) => knowledgeData({ root: at(params), kitRoot, env, params }),
    },
  });
}
