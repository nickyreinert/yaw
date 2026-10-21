// Shared retrieval engine (ADR-0011): Unicode tokenizer, deterministic local embedding, taxonomy
// classification, scope globs and the ranking pipeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIMENSIONS, MODEL, THRESHOLD, classify, cosine, embed, globToRegExp, retrieve, roundVector, scopeMatches, terms, tokenize } from '../core/lib/retrieval.js';
import { KIT_ROOT } from './helpers/fixtures.js';

const TAXONOMY = JSON.parse(readFileSync(join(KIT_ROOT, 'modules', 'decisions', 'templates', '.decisions', 'taxonomy.json'), 'utf8'));

test('tokenizer: German words keep umlauts and ß; NFKC; single code points are dropped', () => {
  assert.deepEqual(tokenize('Größe der Schlüssel-Datei für Straße'), ['größe', 'der', 'schlüssel', 'datei', 'für', 'straße']);
  assert.deepEqual(tokenize('GRÖSSE ÄNDERN'), ['grösse', 'ändern']);
  assert.deepEqual(tokenize('ﬁle Ｆｕｌｌ ①'), ['file', 'full']); // NFKC: ligature, full-width letters; ① becomes 1 (one code point)
  assert.deepEqual(tokenize('a b x1 Δx café'), ['x1', 'δx', 'café']);
  assert.deepEqual(tokenize('été'), tokenize('été'), 'combining accents normalise to the composed form');
  assert.deepEqual(terms('Füge der Tabelle eine Spalte hinzu'), ['füge', 'tabelle', 'spalte', 'hinzu']);
  assert.deepEqual(terms('Add a column to the table'), ['add', 'column', 'table']);
});

test('embedding: deterministic, no credentials, normalised, 384 dimensions; empty text gives an empty vector', () => {
  const env = { ...process.env };
  for (const k of Object.keys(process.env)) if (/KEY|TOKEN|SECRET/i.test(k)) delete process.env[k];
  try {
    const a = embed('Use forward-only database migrations');
    const b = embed('Use forward-only database migrations');
    assert.deepEqual(a, b);
    assert.equal(a.length, DIMENSIONS);
    assert.ok(Math.abs(Math.sqrt(a.reduce((s, v) => s + v * v, 0)) - 1) < 1e-9);
    assert.deepEqual(embed(''), []);
    assert.deepEqual(embed('a the und'), [], 'only stop words and single letters');
    assert.equal(cosine(embed(''), a), 0);
    assert.equal(cosine(a, a.slice(0, 100)), 0, 'unequal length: 0');
    assert.ok(Math.abs(cosine(roundVector(a), a) - 1) < 1e-6, 'rounding to 4 decimals keeps the direction');
    assert.equal(MODEL, 'local-hash-ngram-v2');
  } finally {
    Object.assign(process.env, env);
  }
});

test('embedding: German inflection and compounds stay close through trigrams', () => {
  const record = embed('Datenbankmigrationen werden nur vorwärts geschrieben');
  const near = cosine(embed('Schreibe eine Migration für die Datenbank'), record);
  const far = cosine(embed('Backe einen Zitronenkuchen'), record);
  assert.ok(near > far + 0.05, `${near} vs ${far}`);
});

test('classify: keywords hit exactly, by prefix (inflection) or suffix (German compounds); unrelated text hits nothing', () => {
  assert.deepEqual(classify('Bake a lemon cake', TAXONOMY), []);
  assert.equal(classify('add a database migration', TAXONOMY)[0].subcategory, 'Storage');
  assert.equal(classify('Neue Datenbankmigrationen für die Tabellen', TAXONOMY)[0].subcategory, 'Storage');
  assert.equal(classify('Den Schlüssel nie loggen', TAXONOMY)[0].subcategory, 'Secrets');
  assert.equal(classify('Löschung personenbezogener Daten nach DSGVO', TAXONOMY)[0].subcategory, 'Privacy');
  assert.equal(classify('the latest build', TAXONOMY).some((p) => p.subcategory === 'CI'), false, '"test" (4) is no suffix of "latest"');
  const tax = { categories: [{ name: 'A', subcategories: [{ name: 'B', keywords: ['forward-only'] }] }] };
  assert.equal(classify('forward only please', tax).length, 1, 'multi-word keyword: all words');
  assert.equal(classify('forward please', tax).length, 0);
});

test('scope globs: ** spans folders, * stays in one, ? is one character', () => {
  assert.ok(globToRegExp('src/api/**').test('src/api/v1/users.js'));
  assert.ok(globToRegExp('**/*.sql').test('db/migrations/001.sql'));
  assert.ok(globToRegExp('**/*.sql').test('001.sql'));
  assert.ok(!globToRegExp('src/*.js').test('src/a/b.js'));
  assert.ok(globToRegExp('a?c.md').test('abc.md'));
  assert.ok(!globToRegExp('a.c').test('abc'), 'dots are literal');
  assert.ok(scopeMatches(['db/**'], ['src/x.js', 'db/m/1.sql']));
  assert.ok(!scopeMatches([], ['db/1.sql']));
});

const entry = (id, text, extra = {}) => ({ id, type: 'decision', category: 'Data', subcategory: 'Storage', summary: text.split('.')[0], status: 'accepted', importance: 'normal', scope: [], embedding: roundVector(embed(text)), embeddingModel: MODEL, ...extra });

test('pipeline: threshold, importance weight, retired records, critical, scope, legacy fallback, category fallback', () => {
  const entries = [
    entry('ADR-0001', 'Use forward-only database migrations. Never edit an applied migration.', { importance: 'high' }),
    entry('ADR-0002', 'Keep the sqlite cache table small. Evict old rows nightly.'),
    entry('ADR-0003', 'Old: database migrations may be rolled back.', { status: 'superseded' }),
    entry('ADR-0004', 'Backups run before every schema change.', { importance: 'critical' }),
    entry('ADR-0005', 'Seed data lives in fixtures.', { scope: ['db/seeds/**'] }),
    { ...entry('ADR-0006', 'database migration naming'), embedding: undefined }, // legacy, no vector
    entry('NOTICE-0001', 'Migration logs could leak the secret. Keep the secret out of the log.', { type: 'notice', category: 'Security', subcategory: 'Secrets' }),
  ];
  const { pairs, hits } = retrieve({ text: 'Write a forward-only database migration that adds a column; keep the secret out of the log', entries, taxonomy: TAXONOMY });
  assert.equal(pairs[0].subcategory, 'Storage');
  const by = Object.fromEntries(hits.map((h) => [h.entry.id, h]));
  assert.equal(by['ADR-0001'].reason, 'match');
  assert.ok(by['ADR-0001'].similarity >= THRESHOLD);
  assert.ok(Math.abs(by['ADR-0001'].score - by['ADR-0001'].similarity * 1.2) < 1e-3, 'high = 1.2');
  assert.equal(by['ADR-0003'], undefined, 'superseded is never retrieved');
  assert.equal(by['ADR-0004'].reason, 'critical', 'critical in a matched pair is always included');
  assert.equal(by['ADR-0006'].reason, 'match', 'legacy entry: word overlap with the summary');
  assert.equal(by['NOTICE-0001'].reason, 'match', 'notices: every matched pair');
  assert.equal(by['ADR-0005'], undefined);
  assert.deepEqual(hits.map((h) => h.score), [...hits.map((h) => h.score)].sort((a, b) => b - a), 'sorted by score');

  const scoped = retrieve({ text: 'fix the bug', entries, taxonomy: TAXONOMY, paths: ['db/seeds/users.json'] }).hits;
  assert.deepEqual(scoped.map((h) => [h.entry.id, h.reason]), [['ADR-0005', 'scope']], 'no keyword, but the path is in scope');
  assert.deepEqual(retrieve({ text: 'Bake a lemon cake', entries, taxonomy: TAXONOMY }).hits, []);
  assert.deepEqual(retrieve({ text: 'Bake a lemon cake', entries, taxonomy: TAXONOMY, allCritical: true }).hits.map((h) => h.entry.id), ['ADR-0004'], 'task-start recall: critical always');

  // Another language: the pair is found by a German keyword, no record passes the threshold -> its best decision.
  const fallback = retrieve({ text: 'Tabelle', entries: entries.filter((e) => e.id === 'ADR-0002'), taxonomy: TAXONOMY }).hits;
  assert.deepEqual(fallback.map((h) => [h.entry.id, h.reason]), [['ADR-0002', 'category']]);
  // a vector of another model is not compared; the summary overlap is used instead
  const stale = retrieve({ text: 'database migrations', entries: [{ ...entries[0], embeddingModel: 'other' }], taxonomy: TAXONOMY }).hits;
  assert.equal(stale[0].reason, 'match');
});

test('pipeline: decisions use the best pair (plus a tie), notices every matched pair', () => {
  const tax = { categories: [{ name: 'A', subcategories: [{ name: 'One', keywords: ['alpha', 'beta'] }, { name: 'Two', keywords: ['gamma'] }, { name: 'Three', keywords: ['delta'] }] }] };
  const e = (id, sub, text, type = 'decision') => ({ ...entry(id, text), type, category: 'A', subcategory: sub });
  const entries = [e('ADR-0001', 'One', 'alpha beta gamma delta'), e('ADR-0002', 'Two', 'alpha beta gamma delta'), e('NOTICE-0001', 'Two', 'alpha beta gamma delta', 'notice')];
  const ids = (text) => retrieve({ text, entries, taxonomy: tax }).hits.map((h) => h.entry.id).sort();
  assert.deepEqual(ids('alpha beta gamma'), ['ADR-0001', 'NOTICE-0001'], 'One (2 hits) beats Two (1): decisions of Two drop, its notice stays');
  assert.deepEqual(ids('alpha gamma'), ['ADR-0001', 'ADR-0002', 'NOTICE-0001'], 'a tie takes both pairs');
});
