// Analytics → Savings (T-056, L5): what the compact module cut, and whether it paid off. Sizes and counts only.
// Tokens are bytes / 4, an estimate; the on/off comparison uses stored per-session tokensIn and YAW_VERBOSE=1 re-run counts.

export function savingsRows(entries) {
  return (entries ?? []).map((e) => ({ ...e, savedBytes: e.rawBytes - e.outBytes, estTokensSaved: Math.round((e.rawBytes - e.outBytes) / 4) }))
    .sort((a, b) => b.rawBytes - a.rawBytes || a.tool.localeCompare(b.tool) || a.method.localeCompare(b.method));
}

export function savingsTable(entries, { table, num, str, short }) {
  return table('savings', [str('source', 'Source', (r) => r.source), str('tool', 'Tool or step', (r) => r.tool), str('method', 'Method', (r) => r.method),
    num('calls', 'Results', (r) => r.calls), num('raw', 'rawBytes', (r) => r.rawBytes, (r) => short(r.rawBytes)), num('out', 'outBytes', (r) => r.outBytes, (r) => short(r.outBytes)),
    num('saved', 'Saved', (r) => r.savedBytes, (r) => short(r.savedBytes)), num('tokens', 'Est. tokens saved', (r) => r.estTokensSaved, (r) => short(r.estTokensSaved))],
  savingsRows(entries), { sort: 'raw', note: 'Sizes only, never content. Tokens are bytes / 4, an estimate, not billed tokens. Bytes alone do not prove savings: see the comparison table for tokens in and re-runs.' });
}

// Per project, sessions where the compact module replaced output ("on") against the others ("off"). A mean or count is
// null, never 0, when no session of that group has the data.
export function abRows(rows) {
  const groups = new Map();
  for (const r of rows ?? []) {
    const on = r.compressed === true, key = `${r.project}\u0000${on}`;
    const g = groups.get(key) ?? { project: r.project, on, sessions: 0, usage: 0, tokens: 0, scanned: 0, reruns: 0 };
    g.sessions++;
    if (Number.isFinite(r.tokensIn)) { g.usage++; g.tokens += r.tokensIn; }
    if (r.toolOutput) { g.scanned++; g.reruns += r.toolOutput.verbose ?? 0; }
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => ({ project: g.project, on: g.on, sessions: g.sessions,
    meanTokensIn: g.usage ? Math.round(g.tokens / g.usage) : null,
    reruns: g.scanned ? g.reruns : null, rerunsPerSession: g.scanned ? g.reruns / g.scanned : null }))
    .sort((a, b) => String(a.project).localeCompare(String(b.project)) || b.on - a.on);
}

export function abTable(rows, { table, num, str }) {
  const per = (r) => r.rerunsPerSession === null ? '—' : r.rerunsPerSession.toFixed(2);
  return table('savings-ab', [str('project', 'Project', (r) => r.project), str('on', 'Compact module', (r) => r.on ? 'on' : 'off'), num('sessions', 'Sessions', (r) => r.sessions),
    num('tin', 'Mean tokens in', (r) => r.meanTokensIn), num('reruns', 'YAW_VERBOSE=1 re-runs', (r) => r.reruns), num('rpp', 'Re-runs per session', (r) => r.rerunsPerSession, per)],
  abRows(rows), { sort: 'project', dir: 'asc', note: 'Compare only the same kind of task. A project needs rows for both on and off before the comparison means anything; a dash means no data, not zero. Sessions from before re-runs were counted show no re-run data. No real comparison exists until sessions have been run with the module on and off (needs data).' });
}
