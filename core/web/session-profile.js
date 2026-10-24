// Metadata-only profiling. Filters apply before every aggregate and before the bounded session list.
import { FormError } from './form-model.js';

const DAY = 86400000;
const number = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const known = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const duration = (row) => row.ended && Date.parse(row.ended) >= Date.parse(row.started)
  ? Math.round((Date.parse(row.ended) - Date.parse(row.started)) / 60000) : 0;

export function profileSessions(rows, params = new URLSearchParams(), now = new Date()) {
  const filters = Object.fromEntries(['project', 'agent', 'model', 'days'].map((k) => [k, params.get(k) ?? '']));
  filters.days ||= 'all';
  if (!['7', '30', '90', 'all'].includes(filters.days)) throw new FormError('Choose 7, 30, 90 days or all history.');
  const since = filters.days === 'all' ? -Infinity : now.getTime() - Number(filters.days) * DAY;
  const selected = rows.filter((r) => (!filters.project || r.project === filters.project) &&
    (!filters.agent || r.agent === filters.agent) && (!filters.model || (r.model || 'Unknown') === filters.model) &&
    (since === -Infinity || Date.parse(r.started) >= since));
  const sort = params.get('sort') || 'started';
  const direction = params.get('direction') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Math.floor(Number(params.get('page')) || 1));
  const pageSize = 50;
  const accessors = {
    started: (r) => r.started, project: (r) => r.project, agent: (r) => r.agent, model: (r) => r.model || 'Unknown',
    tokens: (r) => known(r.tokens_in) || known(r.tokens_out) ? number(r.tokens_in) + number(r.tokens_out) : null,
    minutes: (r) => r.ended ? duration(r) : null, cost: (r) => known(r.cost_usd) ? number(r.cost_usd) : null,
  };
  if (!Object.hasOwn(accessors, sort)) throw new FormError('Invalid session sort column.');
  const sorted = [...selected].sort((a, b) => {
    const x = accessors[sort](a), y = accessors[sort](b);
    if (x === null || y === null) return x === y ? a.id.localeCompare(b.id) : x === null ? 1 : -1;
    const compared = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
    return (direction === 'asc' ? compared : -compared) || String(b.started).localeCompare(String(a.started)) || a.id.localeCompare(b.id);
  });
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pages);
  const summarize = (list) => ({
    sessions: list.length,
    minutes: list.reduce((n, r) => n + duration(r), 0),
    tokensIn: list.reduce((n, r) => n + number(r.tokens_in), 0),
    tokensOut: list.reduce((n, r) => n + number(r.tokens_out), 0),
    costUsd: Math.round(list.reduce((n, r) => n + number(r.cost_usd), 0) * 100) / 100,
    usageKnown: list.filter((r) => known(r.tokens_in) || known(r.tokens_out)).length,
    costKnown: list.filter((r) => known(r.cost_usd)).length,
    durationKnown: list.filter((r) => r.ended && Number.isFinite(Date.parse(r.started)) && Date.parse(r.ended) >= Date.parse(r.started)).length,
    measured: list.filter((r) => r.metrics).length,
    prompts: list.reduce((n, r) => n + (r.metrics?.prompts ?? 0), 0),
    answers: list.reduce((n, r) => n + (r.metrics?.answers ?? 0), 0),
    answerChars: list.reduce((n, r) => n + (r.metrics?.answerChars ?? 0), 0),
  });
  const group = (key) => {
    const groups = new Map();
    for (const r of selected) {
      const name = r[key] || 'Unknown';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(r);
    }
    return [...groups].map(([name, list]) => ({ name, ...summarize(list) })).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
  };
  const days = new Map();
  for (const r of selected) {
    if (!Number.isFinite(Date.parse(r.started))) continue;
    const day = new Date(r.started).toISOString().slice(0, 10);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  const histogram = (values, bounds) => bounds.map((bound, i) => ({
    label: i === bounds.length - 1 ? `> ${bounds[i - 1]}` : i === 0 ? `≤ ${bound}` : `${bounds[i - 1]}–${bound}`,
    count: values.filter((v) => v > (bounds[i - 1] ?? -Infinity) && v <= bound).length,
  }));
  return {
    filters, sort, direction, pagination: { page: currentPage, pages, pageSize, total: selected.length }, summary: summarize(selected), models: group('model'), agents: group('agent'), projects: group('project'),
    activity: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([day, sessions]) => ({ day, sessions })),
    outcomes: selected.reduce((out, r) => {
      for (const [label, count] of Object.entries(r.evaluation?.counts?.outcome ?? {})) out[label] = (out[label] ?? 0) + count;
      return out;
    }, {}),
    charts: {
      duration: histogram(selected.filter((r) => r.ended).map(duration), [5, 15, 30, 60, Infinity]),
      answerLength: histogram(selected.filter((r) => r.metrics?.answers).map((r) => r.metrics.answerChars / r.metrics.answers), [200, 1000, 3000, 10000, Infinity]),
      combined: selected.filter((r) => r.metrics && r.ended).slice(0, 200).map((r) => ({ id: r.id, minutes: duration(r), answers: r.metrics.answers })),
    },
    options: Object.fromEntries(['project', 'agent', 'model'].map((key) => [key, [...new Set(rows.map((r) => r[key] || 'Unknown'))].sort()])),
    recent: sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((r) => ({
      id: r.id, project: r.project, agent: r.agent, model: r.model || 'Unknown', title: r.title,
      started: r.started, minutes: r.ended ? duration(r) : null, branch: r.branch,
      tokensIn: known(r.tokens_in) ? number(r.tokens_in) : null,
      tokensOut: known(r.tokens_out) ? number(r.tokens_out) : null,
      costUsd: known(r.cost_usd) ? number(r.cost_usd) : null,
      metrics: r.metrics ?? null, evaluation: r.evaluation ?? null,
      source: r.source === 'local' ? 'Local history' : r.source === 'import' ? 'Imported' : 'Hook',
    })),
  };
}
