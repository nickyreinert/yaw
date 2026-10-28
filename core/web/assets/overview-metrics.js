// Shared metric vocabulary, formatting and coverage for both overview scopes.
const number = (n) => n == null ? '—' : n.toLocaleString('en');
const compact = (n) => n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : number(n);
const elapsed = (m) => m == null ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`;
export function summarizeOverview(rows) {
  const known = (key) => rows.filter((r) => Number.isFinite(r[key]));
  const usage = rows.filter((r) => Number.isFinite(r.tokensIn) || Number.isFinite(r.tokensOut));
  return { sessions: rows.length, agents: new Set(rows.map((r) => r.agent)).size,
    tokens: usage.reduce((n, r) => n + (r.tokensIn ?? 0) + (r.tokensOut ?? 0), 0), usageSessions: usage.length,
    costUsd: known('cost').reduce((n, r) => n + r.cost, 0), costSessions: known('cost').length,
    minutes: known('minutes').reduce((n, r) => n + r.minutes, 0), timedSessions: known('minutes').length };
}
export function overviewMetricItems({ summary, projects, openTasks, projectNote = '', taskNote = '' }) {
  const coverage = (count) => summary ? `${count}/${summary.sessions} sessions reported` : 'No saved data';
  return [
    ['Projects', number(projects), projectNote], ['Sessions', number(summary?.sessions), 'Saved history'],
    ['Agents', number(summary?.agents), 'With saved sessions'],
    ['Tokens', summary?.usageSessions ? compact(summary.tokens) : '—', coverage(summary?.usageSessions)],
    ['Elapsed', summary?.timedSessions ? elapsed(summary.minutes) : '—', 'Includes idle time'],
    ['Reported cost', summary?.costSessions ? `$${summary.costUsd.toFixed(2)}` : '—', coverage(summary?.costSessions)],
    ['Open tasks', number(openTasks), taskNote],
  ];
}
export function renderOverviewMetrics(root, data) {
  root.classList.add('overview-metrics'); root.replaceChildren();
  for (const [label, value, note] of overviewMetricItems(data)) {
    const card = document.createElement('div'); card.className = 'metric';
    for (const [tag, text, cls] of [['span', label, 'eyebrow'], ['strong', value, ''], ['span', note, 'muted']]) {
      const node = document.createElement(tag); node.textContent = text; node.className = cls; card.append(node);
    }
    root.append(card);
  }
}
