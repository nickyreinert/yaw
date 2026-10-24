// Merge saved metadata with registry entries; never discover or read agent histories here.

export function mergeHistory(registered, local) {
  const rows = new Map(registered.map((r) => [r.id, { ...r }]));
  for (const s of local) {
    const previous = rows.get(s.id);
    if (!previous) rows.set(s.id, { ...s });
    else rows.set(s.id, {
      ...previous, ended: previous.ended > s.ended ? previous.ended : s.ended,
      model: s.model || previous.model, tokens_in: s.tokens_in ?? previous.tokens_in,
      tokens_out: s.tokens_out ?? previous.tokens_out, cost_usd: s.cost_usd ?? previous.cost_usd, source: 'local',
      metrics: s.metrics, evaluation: s.evaluation,
    });
  }
  return [...rows.values()].sort((a, b) => String(b.started).localeCompare(String(a.started)));
}
