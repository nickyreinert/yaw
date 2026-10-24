// Read-only global history, cached briefly so filtering does not rescan transcripts.
// Only the import reader's metadata is retained; conversation text and transcript paths never leave it.
import { findSessions } from '../../modules/sessions/lib/import.js';
import { realRoot, sessionId } from '../../modules/sessions/lib/registry.js';

const cache = new Map();
export async function localHistory(env, { refresh = false } = {}) {
  const key = JSON.stringify([env.HOME, env.CLAUDE_CONFIG_DIR, env.CODEX_HOME]);
  let entry = cache.get(key);
  if (!entry || (refresh || Date.now() - entry.created > 60000) && !entry.pending) {
    if (cache.size > 8) cache.delete(cache.keys().next().value);
    entry = { created: Date.now(), pending: true };
    entry.promise = findSessions({ env, allProjects: true }).then((sessions) => sessions.map((s) => ({
      id: sessionId(s.agent, s.native), project: realRoot(s.cwd), agent: s.agent, title: '',
      started: s.started, ended: s.ended, branch: s.branch, model: s.model,
      tokens_in: s.tokensIn, tokens_out: s.tokensOut, cost_usd: s.costUsd, source: 'local',
    })).filter((s) => s.id)).catch((e) => { cache.delete(key); throw e; }).finally(() => { entry.pending = false; });
    cache.set(key, entry);
  }
  return entry.promise;
}

export function mergeHistory(registered, local) {
  const rows = new Map(registered.map((r) => [r.id, { ...r }]));
  for (const s of local) {
    const previous = rows.get(s.id);
    if (!previous) rows.set(s.id, { ...s });
    else rows.set(s.id, {
      ...previous, ended: previous.ended > s.ended ? previous.ended : s.ended,
      model: s.model || previous.model, tokens_in: s.tokens_in ?? previous.tokens_in,
      tokens_out: s.tokens_out ?? previous.tokens_out, cost_usd: s.cost_usd ?? previous.cost_usd, source: 'local',
    });
  }
  return [...rows.values()].sort((a, b) => String(b.started).localeCompare(String(a.started)));
}
