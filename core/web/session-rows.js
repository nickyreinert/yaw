// Metadata-only session rows for the dashboard. The browser filters, splits, charts and sorts them; the server only
// normalises and bounds the list. Message text is never part of a row (saved scans hold none).
export const MAX_ROWS = 20000;

const known = (value) => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;
const amount = (value) => known(value) ? Number(value) : null;
const minutes = (row) => {
  const start = Date.parse(row.started), end = Date.parse(row.ended);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.round((end - start) / 60000) : null;
};
const seconds = (ms) => known(ms) ? Math.round(Number(ms) / 100) / 10 : null;
// The most frequent confident outcome of a classified session; `unknown` only when nothing else was predicted.
const outcomeOf = (counts) => {
  const ranked = Object.entries(counts ?? {}).filter(([, n]) => n > 0).sort((a, b) => (a[0] === 'unknown') - (b[0] === 'unknown') || b[1] - a[1]);
  return ranked[0]?.[0] ?? null;
};

function compact(r) {
  const m = r.metrics, e = r.evaluation;
  return {
    id: r.id, project: r.project, agent: r.agent, model: r.model || 'Unknown', title: r.title || '', branch: r.branch || '',
    source: ['local', 'import', 'synced'].includes(r.source) ? r.source : 'hook',
    started: Date.parse(r.started), minutes: minutes(r),
    tokensIn: amount(r.tokens_in), tokensOut: amount(r.tokens_out), cost: amount(r.cost_usd),
    prompts: m ? m.prompts : null, answers: m ? m.answers : null, promptChars: m ? m.promptChars ?? null : null, answerChars: m ? m.answerChars : null,
    medianAnswer: m?.medianAnswerChars ?? null, p95Answer: m?.p95AnswerChars ?? null,
    medianResp: seconds(m?.medianResponseMs), p95Resp: seconds(m?.p95ResponseMs), partial: Boolean(m?.limited),
    outcome: e ? outcomeOf(e.counts?.outcome) : null,
    evaluation: e ? { classified: e.classified, skipped: e.skipped, counts: e.counts, evaluated: e.evaluated } : null,
  };
}

// Newest first; rows without a valid start time cannot be placed on any chart and are counted, not sent.
export function sessionRows(rows) {
  const dated = rows.filter((r) => Number.isFinite(Date.parse(r.started)));
  const sorted = dated.sort((a, b) => Date.parse(b.started) - Date.parse(a.started) || String(a.id).localeCompare(String(b.id)));
  return { total: rows.length, undated: rows.length - dated.length, limited: sorted.length > MAX_ROWS, rows: sorted.slice(0, MAX_ROWS).map(compact) };
}
