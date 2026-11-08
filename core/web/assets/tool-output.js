// Analytics → Tool output (T-048, L5): how much of a session is tool results, by tool and by the Bash command's first word.
// Rows carry sizes and names only (`toolOutput: { tools, commands }`); no output text or command arguments are ever stored.
const KINDS = [['tools', 'Tool'], ['commands', 'Command']];

// Share is of all tool-result bytes (the tools total); a command is also counted under Bash, so shares of the two kinds overlap.
export function toolOutputRows(rows) {
  const groups = new Map();
  let total = 0;
  for (const r of rows) for (const [field, kind] of KINDS) for (const [name, t] of Object.entries(r.toolOutput?.[field] ?? {})) {
    const g = groups.get(`${kind}\u0000${name}`) ?? { kind, name, calls: 0, bytes: 0, max: 0, sessions: 0 };
    g.calls += t.calls; g.bytes += t.bytes; g.max = Math.max(g.max, t.max); g.sessions++;
    groups.set(`${kind}\u0000${name}`, g);
    if (field === 'tools') total += t.bytes;
  }
  return [...groups.values()].map((g) => ({ ...g, share: total ? g.bytes / total : null })).sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));
}

export function toolOutputTable(rows, { table, num, str, short }) {
  const pct = (r) => r.share === null ? '—' : `${(r.share * 100).toFixed(1)}%`;
  return table('tooloutput', [str('kind', 'Kind', (r) => r.kind), str('name', 'Name', (r) => r.name),
    num('calls', 'Results', (r) => r.calls), num('sessions', 'Sessions', (r) => r.sessions),
    num('bytes', 'Bytes', (r) => r.bytes, (r) => short(r.bytes)), num('max', 'Largest', (r) => r.max, (r) => short(r.max)),
    num('share', 'Share of tool output', (r) => r.share, pct), num('tokens', 'Est. tokens', (r) => Math.round(r.bytes / 4), (r) => short(Math.round(r.bytes / 4)))],
  toolOutputRows(rows), { sort: 'bytes', note: 'Sizes only, never content. Tokens are bytes / 4, an estimate. Claude Code sessions scanned after this feature; lines over 4 MiB are skipped.' });
}
