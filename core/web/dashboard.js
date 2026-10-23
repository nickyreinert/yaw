// Local dashboard (#172): `yaw web` in a YAW project. Read-only: project, tasks, decisions and session stats
// (this project and all projects in ~/.yaw/yaw.db). Served by the form server's handshake (ADR-0044), so the
// same one-time token, cookie, host and origin checks apply; there is no POST route.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readManifest } from '../render/manifest.js';
import { enabledModules, readAnswers } from '../render/project.js';
import { parseTasks, tasksMode } from '../lib/tasks.js';
import { startFormServer } from './form-server.js';

const asset = (name, type) => [`/${name}`, [type, readFileSync(new URL(`./assets/${name}`, import.meta.url))]];
const DASHBOARD_ASSETS = new Map([
  asset('dashboard.js', 'text/javascript; charset=utf-8'),
  asset('app.css', 'text/css; charset=utf-8'),
]);
const page = () => readFileSync(new URL('./assets/dashboard.html', import.meta.url), 'utf8');

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
  const doc = readAnswers(root) ?? {};
  const answers = doc.answers ?? {};
  const modules = enabledModules(manifest);
  return {
    name: basename(root),
    root,
    kit: manifest.kit,
    mode: doc.mode ?? null,
    idea: typeof answers['idea.text'] === 'string' ? answers['idea.text'] : '',
    agents: answers['user.agents'] ?? [],
    profiles: doc.proposal?.profiles ?? [],
    modules,
    tasks: modules.includes('tasks') ? tasksMode(answers, { teamModule: modules.includes('team') }) : null,
  };
}

function tasksSection(root) {
  const file = join(root, 'TASKS.md');
  if (!existsSync(file)) return { available: false };
  const ledger = parseTasks(readFileSync(file, 'utf8'), { file: 'TASKS.md' });
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

// Session stats from the registry. A missing registry is reported, never created by the dashboard.
export async function sessionsSection(root, kitRoot, env, now = new Date()) {
  const registry = await import(pathToFileURL(join(kitRoot, 'modules', 'sessions', 'lib', 'registry.js')).href);
  if (!existsSync(registry.registryFile(env))) return { available: false };
  return registry.withRegistry(env, (db) => {
    const project = registry.realRoot(root);
    const rows = db.prepare('SELECT id, agent, project, title, started, ended, branch, pr FROM sessions ORDER BY started DESC').all();
    const links = db.prepare("SELECT session_id, kind, COUNT(*) AS n FROM session_links GROUP BY session_id, kind").all();
    const linkCount = new Map();
    for (const l of links) linkCount.set(`${l.session_id}\u0000${l.kind}`, Number(l.n));
    const summarize = (list) => {
      const byAgent = {};
      let total = 0;
      for (const r of list) {
        const m = minutes(r);
        total += m;
        byAgent[r.agent] ??= { sessions: 0, minutes: 0 };
        byAgent[r.agent].sessions += 1;
        byAgent[r.agent].minutes += m;
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
      return { sessions: list.length, minutes: total, byAgent, last30Days: days };
    };
    const mine = rows.filter((r) => r.project === project);
    const projects = {};
    for (const r of rows) {
      projects[r.project] ??= { project: r.project, sessions: 0, minutes: 0, last: r.started };
      projects[r.project].sessions += 1;
      projects[r.project].minutes += minutes(r);
      if (r.started > projects[r.project].last) projects[r.project].last = r.started;
    }
    return {
      available: true,
      project: {
        ...summarize(mine),
        recent: mine.slice(0, 50).map((r) => ({
          id: r.id, agent: r.agent, title: registry.clean(r.title), started: r.started, ended: r.ended,
          minutes: minutes(r), branch: registry.clean(r.branch), pr: r.pr,
          commits: linkCount.get(`${r.id}\u0000commit`) ?? 0, tasks: linkCount.get(`${r.id}\u0000task`) ?? 0,
        })),
      },
      all: { ...summarize(rows), projects: Object.values(projects).sort((a, b) => b.sessions - a.sessions).slice(0, 50) },
    };
  });
}

export async function dashboardData({ root, kitRoot, env, now }) {
  const project = section(() => projectSection(root));
  const [decisions, sessions] = await Promise.all([
    decisionsSection(root, kitRoot).catch((e) => ({ error: String(e.message ?? e).split('\n')[0] })),
    sessionsSection(root, kitRoot, env, now).catch((e) => ({ error: String(e.message ?? e).split('\n')[0] })),
  ]);
  return { project, tasks: section(() => tasksSection(root)), decisions, sessions, generated: (now ?? new Date()).toISOString() };
}

export async function startDashboard({ root, kitRoot, env, port, signals, onClose, idleMs }) {
  return startFormServer({
    port, signals, onClose, idleMs, page, assets: DASHBOARD_ASSETS,
    get: { '/api/dashboard': () => dashboardData({ root, kitRoot, env }) },
  });
}
