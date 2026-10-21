// Dogfooding (Y-3.8, BUILD.md rule 9, BD7): this repo is set up with YAW itself, profile node-cli.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from '../core/render/manifest.js';
import { fileStates } from '../core/render/project.js';
import { KIT_ROOT, capture, hasTool, run } from './helpers/fixtures.js';
import { main } from '../core/cli/main.js';

test('this repo has a valid YAW manifest for node-cli with core, security and decisions', () => {
  const m = readManifest(KIT_ROOT);
  assert.ok(m, '.yaw/manifest.json exists');
  assert.deepEqual(m.profiles, ['node-cli']);
  assert.deepEqual(Object.keys(m.modules).sort(), ['core', 'decisions', 'security']);
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'justfile', 'just/node-cli.just', '.yaw/answers.yaml']) {
    assert.ok(m.files.some((x) => x.path === f), f);
  }
});

test('no managed file of this repo is missing or in conflict', () => {
  const states = fileStates(KIT_ROOT, readManifest(KIT_ROOT));
  assert.deepEqual(states.filter((s) => s.state === 'missing' || s.state === 'conflict').map((s) => s.path), []);
});

test('the repo keeps its own package.json; its ADRs moved from docs/adr/ to .decisions/ (BD7, Y-5.6)', () => {
  assert.ok(!readManifest(KIT_ROOT).files.some((f) => f.path === 'package.json'), 'no scaffold in a repo with code');
  assert.ok(!existsSync(join(KIT_ROOT, 'docs', 'adr')), 'docs/adr/ is gone');
  for (const n of ['0001', '0007', '0009', '0011', '0027', '0028']) {
    assert.ok(existsSync(join(KIT_ROOT, '.decisions', `ADR-${n}.md`)), `short record ADR-${n}`);
    assert.ok(existsSync(join(KIT_ROOT, '.decisions', 'details', `ADR-${n}.md`)), `detail doc ADR-${n}`);
  }
});

test('the decision journal of this repo passes yaw decisions check (IDs unique, index up to date)', async () => {
  const out = capture();
  const code = await main(['decisions', 'check'], { stdout: out, stderr: out, cwd: KIT_ROOT });
  assert.equal(code, 0, out.text());
  assert.doesNotMatch(out.text(), /^error:/m);
});

// Retrieval eval set (blueprint N5): prompts in English and German against this repository's journal.
const EVAL = [
  ['Change the hook dispatcher so a handler can return additionalContext on UserPromptSubmit', ['ADR-0007']],
  ['Füge einen neuen Hook für Codex hinzu', ['ADR-0021', 'ADR-0007']],
  ['Add a new keyword to the JSON schema validator', ['ADR-0005']],
  ['Der YAML-Parser soll Anker unterstützen', ['ADR-0001']],
  ['yaw update overwrote my edited AGENTS.md, fix the merge', ['ADR-0003']],
  ['Wie werden Skills für Claude kopiert?', ['ADR-0012']],
  ['Allow rm -rf in the destructive guard for build folders', ['ADR-0022']],
  ['Install the kit on Windows without WSL', ['ADR-0008']],
  ['Erstelle eine neue Aufgabe in TASKS.md mit einer T-NNN-Nummer', ['ADR-0010']],
  ['Store the session registry in a new sqlite table', ['ADR-0018']],
  ['Ändere den Tokenizer für den Abruf von Entscheidungen', ['ADR-0011']],
];

test('retrieval eval: English and German prompts find the expected ADRs; unrelated work finds nothing', async () => {
  const { readIndex, readTaxonomy } = await import('../modules/decisions/lib/journal.js');
  const { retrieve } = await import('../core/lib/retrieval.js');
  const index = readIndex(KIT_ROOT);
  const taxonomy = readTaxonomy(KIT_ROOT);
  for (const [text, want] of EVAL) {
    const ids = retrieve({ text, entries: index.entries, taxonomy, model: index.model }).hits.map((h) => h.entry.id);
    for (const id of want) assert.ok(ids.includes(id), `${text}: ${id} missing in ${ids.join(', ')}`);
  }
  assert.deepEqual(retrieve({ text: 'Bake a lemon cake', entries: index.entries, taxonomy, model: index.model }).hits, []);
  const superseded = retrieve({ text: 'step 1 code and test layout of the repository', entries: index.entries, taxonomy, model: index.model }).hits.map((h) => h.entry.id);
  assert.ok(!superseded.includes('ADR-0016'), 'a superseded record is never retrieved');
});

test('just check runs the kit tests (npm test)', () => {
  assert.match(readFileSync(join(KIT_ROOT, 'just', 'node-cli.just'), 'utf8'), /^test:\n {4}npm test$/m);
  assert.match(JSON.parse(readFileSync(join(KIT_ROOT, 'package.json'), 'utf8')).scripts.test, /^node --test /);
});

test('just --list works in the repo', { skip: !hasTool('just') && 'just is not installed' }, () => {
  const r = run('just', ['--list'], { cwd: KIT_ROOT });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {4}check\b/m);
});
