// Shared retrieval engine (ADR-0011): one tokenizer, one local embedding, one ranking pipeline for every
// memory store (decision journal Y-5.6; session search Y-5.7 and the global knowledge store reuse it).
// Pure functions, no file I/O, no network, deterministic (governance blueprint E1–E4, K1).
//
// Unicode-aware (M2): text is NFKC-normalised and lower-cased, tokens are runs of letters and digits in
// any script, so German prompts ("Datenbankmigrationen für die Größe") tokenize like English ones.

export const MODEL = 'local-hash-ngram-v2';
export const DIMENSIONS = 384;
export const THRESHOLD = 0.12;
export const IMPORTANCE_WEIGHT = { critical: 1.5, high: 1.2, normal: 1.0, low: 0.8 };
export const RETIRED = ['superseded', 'deprecated'];

const TOKEN = /[\p{L}\p{N}]+/gu;

export function normalise(text) {
  return String(text ?? '').normalize('NFKC').toLowerCase();
}

// Tokens of two or more code points (single letters and digits carry no meaning).
export function tokenize(text) {
  return (normalise(text).match(TOKEN) ?? []).filter((t) => [...t].length > 1);
}

// Function words of English and German (the languages the docs name), dropped before embedding: shared
// function words made unrelated texts look similar (eval set, ADR-0011). Classification keeps every token.
export const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'do', 'for', 'from', 'has', 'have', 'how', 'if', 'in', 'into', 'is',
  'it', 'its', 'of', 'on', 'or', 'our', 'so', 'that', 'the', 'their', 'then', 'there', 'these', 'this', 'to', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'without', 'you', 'your',
  'aber', 'als', 'am', 'auch', 'auf', 'aus', 'bei', 'bin', 'bis', 'das', 'dass', 'dem', 'den', 'der', 'des', 'die', 'dies', 'diese',
  'doch', 'du', 'durch', 'ein', 'eine', 'einem', 'einen', 'einer', 'eines', 'er', 'es', 'für', 'hat', 'hatte', 'ich', 'ihr', 'im',
  'ist', 'ja', 'kann', 'man', 'mit', 'nach', 'nicht', 'noch', 'nur', 'ob', 'oder', 'sich', 'sie', 'sind', 'soll', 'über', 'um',
  'und', 'uns', 'von', 'vor', 'war', 'was', 'wenn', 'werden', 'wie', 'wir', 'wird', 'wo', 'zu', 'zum', 'zur',
]);

// Tokens that carry meaning: tokenize() without stop words.
export function terms(text) {
  return tokenize(text).filter((t) => !STOP_WORDS.has(t));
}

// FNV-1a, 32 bit, over UTF-16 code units (deterministic for every script).
function hash(feature) {
  let h = 2166136261;
  for (let i = 0; i < feature.length; i += 1) {
    h ^= feature.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 384-dim signed feature hashing (blueprint E2) over terms(): words (2), character trigrams over code points
// (0.25), adjacent-word bigrams (1); L2-normalised; no terms -> [] (similarity 0).
export function embed(text) {
  const tokens = terms(text);
  if (tokens.length === 0) return [];
  const vector = new Array(DIMENSIONS).fill(0);
  const add = (feature, weight) => {
    const h = hash(feature);
    vector[h % DIMENSIONS] += (h & 0x80000000 ? -1 : 1) * weight;
  };
  for (const token of tokens) {
    add(`w:${token}`, 2);
    const chars = [...`^${token}$`];
    for (let i = 0; i <= chars.length - 3; i += 1) add(`c:${chars.slice(i, i + 3).join('')}`, 0.25);
  }
  for (let i = 0; i < tokens.length - 1; i += 1) add(`b:${tokens[i]}_${tokens[i + 1]}`, 1);
  const magnitude = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  return vector.map((v) => v / magnitude);
}

// Vectors are stored rounded (smaller index, stable diffs); cosine is unaffected at this precision.
export function roundVector(vector) {
  return vector.map((v) => Math.round(v * 1e4) / 1e4);
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let am = 0;
  let bm = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    am += a[i] * a[i];
    bm += b[i] * b[i];
  }
  return am === 0 || bm === 0 ? 0 : dot / (Math.sqrt(am) * Math.sqrt(bm));
}

// Does a text token hit a taxonomy keyword? Exact, or (inflection and German compounds) the token starts
// with a keyword of 4+ code points ("migrationen") or ends with one of 5+ ("datenbankmigration").
function hits(token, keyword) {
  if (token === keyword) return true;
  const n = [...keyword].length;
  return (n >= 4 && token.startsWith(keyword)) || (n >= 5 && token.endsWith(keyword));
}

// Stage 1 (blueprint E4): keyword hits per (category, subcategory) -> pairs with score > 0, best first.
// A keyword of several words ("forward-only") hits when every one of its tokens does.
export function classify(text, taxonomy) {
  const tokens = [...new Set(tokenize(text))];
  const pairs = [];
  for (const category of taxonomy?.categories ?? []) {
    for (const sub of category.subcategories ?? []) {
      let score = 0;
      for (const keyword of sub.keywords ?? []) {
        const parts = tokenize(keyword);
        if (parts.length > 0 && parts.every((p) => tokens.some((t) => hits(t, p)))) score += 1;
      }
      if (score > 0) pairs.push({ category: category.name, subcategory: sub.name, score });
    }
  }
  return pairs.sort((a, b) => b.score - a.score || a.category.localeCompare(b.category) || a.subcategory.localeCompare(b.subcategory));
}

// Glob for `scope` (path-aware recall, blueprint F4): `**` any path, `*` any name part, `?` one character.
export function globToRegExp(glob) {
  let re = '';
  const g = String(glob).replace(/^\.\//, '');
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      i += 1;
      if (g[i + 1] === '/') {
        i += 1;
        re += '(?:.*/)?';
      } else {
        re += '.*';
      }
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`, 'u');
}

export function scopeMatches(scope, paths) {
  if (!Array.isArray(scope) || scope.length === 0 || paths.length === 0) return false;
  const res = scope.map(globToRegExp);
  return paths.some((p) => res.some((re) => re.test(p)));
}

// Similarity of an entry: cosine on a current vector, else lexical overlap over its summary (legacy
// fallback for entries without a vector or with a vector from another model, blueprint E4/E5).
function similarity(entry, queryVector, queryTokens, model) {
  if (Array.isArray(entry.embedding) && entry.embedding.length === DIMENSIONS && (entry.embeddingModel ?? model) === MODEL) {
    return cosine(queryVector, entry.embedding);
  }
  const words = new Set(terms(entry.summary));
  if (words.size === 0) return 0;
  return queryTokens.filter((t) => words.has(t)).length / words.size;
}

// The pipeline (blueprint E4 with the D2 / N2 / N3 / N4 / N6 upgrades, ADR-0011):
//   1 classify the text against the taxonomy
//   2 filter: decisions in the best pair (plus a second pair with the same score), notices in every pair;
//     superseded and deprecated entries never come back
//   3 rank: similarity >= threshold, score = similarity x importance weight
//   + critical entries in a matched pair always; entries whose `scope` matches a given path always;
//     with `allCritical`, every critical entry (the task-start recall, which replaces SessionStart injection);
//     a best pair without a decision above the threshold still yields its best-ranked decision ('category')
// entries: index entries { id, type: decision|notice, category, subcategory, summary, status, importance,
// scope, embedding, embeddingModel }. -> { pairs, hits: [{ entry, similarity, score, reason }] }
export function retrieve({ text, entries, taxonomy, paths = [], model = MODEL, type = 'all', pair = null, allCritical = false, threshold = THRESHOLD }) {
  const pairs = pair ? [{ ...pair, score: 1 }] : classify(text, taxonomy);
  const best = pairs.filter((p, i) => i === 0 || (i === 1 && p.score === pairs[0].score));
  const inPairs = (e, list) => list.some((p) => p.category === e.category && p.subcategory === e.subcategory);
  const queryVector = embed(text);
  const queryTokens = terms(text);
  const out = [];
  const misses = [];
  for (const entry of entries) {
    if (RETIRED.includes(entry.status)) continue;
    if (type !== 'all' && entry.type !== type) continue;
    const critical = entry.importance === 'critical';
    const matched = inPairs(entry, entry.type === 'notice' ? pairs : best);
    const sim = similarity(entry, queryVector, queryTokens, model);
    let reason = null;
    if (matched && sim >= threshold) reason = 'match';
    else if (matched && critical) reason = 'critical';
    else if (scopeMatches(entry.scope, paths)) reason = 'scope';
    else if (allCritical && critical) reason = 'critical';
    const hit = { entry, similarity: Math.round(sim * 1e4) / 1e4, score: Math.round(sim * (IMPORTANCE_WEIGHT[entry.importance] ?? 1) * 1e4) / 1e4, reason };
    if (reason) out.push(hit);
    else if (matched && entry.type === 'decision') misses.push(hit);
  }
  // The taxonomy does the heavy lifting, the vector ranks within the pair (blueprint E1): a best pair whose
  // decisions all stay below the threshold (a German prompt against English records) still yields its
  // best-ranked decision.
  for (const p of best) {
    const own = (h) => h.entry.category === p.category && h.entry.subcategory === p.subcategory && h.entry.type === 'decision';
    if (out.some((h) => own(h) && h.reason === 'match')) continue;
    const top = misses.filter(own).sort((a, b) => b.similarity - a.similarity)[0];
    if (top) out.push({ ...top, reason: 'category' });
  }
  out.sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  return { pairs, hits: out };
}
