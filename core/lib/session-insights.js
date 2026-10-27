// Explicit, temporary transcript review. Discovery reuses saved file hashes so it never parses unselected histories.
import { createHash } from 'node:crypto';
import { transcriptFiles } from '../../modules/sessions/lib/import.js';
import { effectiveSources } from './session-sources.js';
import { readAnalysis, readTurns } from './session-analysis.js';

export const INSIGHTS_LIMITS = Object.freeze({ sessions: 5, bytes: 8 * 1024 * 1024, messages: 1000, candidates: 5, excerptChars: 6000, messageChars: 1200 });
const hash = (s) => createHash('sha256').update(s).digest('hex');
// Deliberately tentative phrase hints, not semantic predictions or measured detector accuracy.
const HINTS = [
  ['Possible correction', /\b(i meant|that(?:'s| is) not what|wrong (?:component|file|scope)|you (?:missed|ignored)|not what i asked)\b|ich meinte|falsch verstanden|je voulais dire|no es lo que ped[ií]/iu],
  ['Possible admission or apology', /\b(i (?:overlooked|misunderstood|missed)|you(?:'re| are) right|my mistake|i(?:'m| am) sorry|i apologize)\b|mein fehler|tut mir leid|d[eé]sol[eé]|lo siento/iu],
  ['Possible acceptance or recovery', /\b(thanks.{0,16}(?:works|fixed)|that works|looks good|thank you|problem solved)\b|funktioniert|merci|gracias/iu],
];

export function reviewCandidates(messages, { turn, limited = false } = {}) {
  const turns = [];
  for (const m of messages) {
    if (m.role === 'user') turns.push({ number: turns.length + 1, messages: [m] });
    else if (turns.length) turns.at(-1).messages.push(m);
  }
  const reasons = (t) => HINTS.filter(([, re]) => t.messages.some((m) => re.test(m.text))).map(([label]) => label);
  let chosen;
  if (turn !== undefined) {
    if (!Number.isInteger(turn) || turn < 1 || turn > turns.length) throw new Error(`Choose a turn from 1 to ${turns.length || 1} in the readable portion`);
    chosen = [turns[turn - 1]];
  } else {
    // Spread hints across the readable session, retaining an ordinary exchange as a comparison.
    const hinted = turns.filter((t) => reasons(t).length);
    const spread = (xs, n) => xs.length <= n ? xs : n === 1 ? [xs[Math.floor(xs.length / 2)]] : Array.from({ length: n }, (_, i) => xs[Math.round(i * (xs.length - 1) / (n - 1))]);
    chosen = spread(hinted, 4);
    const ordinary = turns.filter((t) => !reasons(t).length);
    chosen = [...chosen, ...spread(ordinary, Math.max(1, INSIGHTS_LIMITS.candidates - chosen.length))].sort((a, b) => a.number - b.number);
  }
  return { turns: turns.length, limited, candidates: chosen.map((t) => {
    const index = t.number - 1, indices = [...new Set([0, index - 1, index, index + 1].filter((i) => i >= 0 && i < turns.length))].sort((a, b) => a - b);
    const notes = [];
    if (limited) notes.push('Transcript read is partial; later turns or broken lines may be missing.');
    if (index === 0) notes.push('No preceding exchange is available.');
    if (index === turns.length - 1) notes.push('No following user reaction is available in the readable portion.');
    let previous = -1;
    const chunks = [];
    for (const i of indices) {
      if (i > previous + 1) chunks.push('[Intervening exchanges omitted]');
      const group = turns[i];
      chunks.push(`Turn ${group.number}${i === index ? ' (selected)' : i === 0 ? ' (original recorded request)' : ' (context)'}`);
      const limit = i === index ? INSIGHTS_LIMITS.messageChars : 500;
      const excerpt = (role, text) => `${role}: ${text.slice(0, limit)}${text.length > limit ? '\n[Message excerpt shortened]' : ''}`;
      chunks.push(excerpt('user', group.messages[0].text));
      // Bound combined assistant output so original context cannot displace the selected correction or reaction.
      if (i !== index + 1) {
        const answers = group.messages.filter((m) => m.role === 'assistant').map((m) => m.text).join('\n');
        if (answers) chunks.push(excerpt('assistant (recorded answers combined)', answers));
        else chunks.push('[No recorded assistant answer for this turn]');
      }
      previous = i;
    }
    let excerpt = chunks.join('\n\n');
    if (excerpt.length > INSIGHTS_LIMITS.excerptChars) excerpt = `${excerpt.slice(0, INSIGHTS_LIMITS.excerptChars - 40)}\n[Context omitted: excerpt size limit]`;
    return { turn: t.number, reasons: reasons(t).length ? reasons(t) : ['Ordinary exchange for manual comparison'], notes, excerpt };
  }) };
}

export async function reviewSessions({ env, ids, turn }) {
  if (!Array.isArray(ids) || !ids.length || ids.length > INSIGHTS_LIMITS.sessions || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== 'string' || !id || id.length > 512)) {
    throw new Error(`Choose 1–${INSIGHTS_LIMITS.sessions} distinct saved local sessions`);
  }
  if (turn !== undefined && (ids.length !== 1 || !Number.isInteger(turn) || turn < 1 || turn > INSIGHTS_LIMITS.messages)) throw new Error('Choose one session and a valid turn number');
  const saved = readAnalysis(env).rows;
  const selected = ids.map((id) => saved.find((r) => r.id === id && r.source !== 'synced'));
  if (selected.some((r) => !r)) throw new Error('A selected session has no saved local scan. Refresh Sessions and select again.');
  const found = new Map(transcriptFiles(effectiveSources(env)).map(({ agent, file }) => [`${agent}:${hash(file)}`, file]));
  const sessions = [];
  for (const [index, row] of selected.entries()) {
    const file = found.get(`${row.agent}:${row.file_key}`);
    const base = { id: row.id, exampleSession: `S${index + 1}` };
    if (!file) { sessions.push({ ...base, unavailable: 'Local transcript unavailable in the configured folders.', candidates: [] }); continue; }
    let read;
    try { read = await readTurns(file, row.agent, { maxBytes: INSIGHTS_LIMITS.bytes, maxMessages: INSIGHTS_LIMITS.messages }); }
    catch { sessions.push({ ...base, unavailable: 'Transcript could not be read safely or exceeds the read limit.', candidates: [] }); continue; }
    sessions.push({ ...base, ...reviewCandidates(read.messages, { turn, limited: read.limited }) });
  }
  return { sessions, limits: INSIGHTS_LIMITS, message: 'Temporary phrase suggestions and manual examples only. No model was called and no excerpts were saved.' };
}
