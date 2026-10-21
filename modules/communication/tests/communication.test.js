// communication + standards (Y-5.1, ADR-0013, ADR-0024): rendering from the profile, output style only when
// non-default, team-mode rule, overlay limit, removal with zero residue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from '../../../core/render/manifest.js';
import { initProject, readAnswers, removeModule, addModule } from '../../../core/render/project.js';
import { OVERLAY_MAX_LINES } from '../../../core/render/kit.js';
import { KIT_ROOT, read, readJson, readTree, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';

const MODULES = ['core', 'communication', 'standards'];

function answers({ agents = ['claude', 'codex', 'copilot'], extra = {}, profile = 'node-cli' } = {}) {
  const lines = ['mode: quick', 'answers:', `  user.agents: [${agents.join(', ')}]`, '  idea.text: A tiny command-line tool.'];
  for (const [k, v] of Object.entries(extra)) lines.push(`  ${k}: ${v}`);
  lines.push('proposal:', '  status: confirmed', '  summary: test project', `  profiles: [${profile}]`, `  modules: [${MODULES.join(', ')}]`);
  return `${lines.join('\n')}\n`;
}

async function project(opts = {}) {
  const root = tmp('yaw-comm-');
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-ans-'), answers(opts)), modules: MODULES });
  return root;
}

const section = (text, module) => text.match(new RegExp(`<!-- yaw:${module} -->\\n([\\s\\S]*?)<!-- /yaw:${module} -->`))?.[1];

test('default profile: about six lines in AGENTS.md, no output style, no settings entry', async () => {
  const root = await project();
  const body = section(read(root, 'AGENTS.md'), 'communication');
  const lines = body.trim().split('\n');
  assert.equal(lines.length, 7); // heading, blank line, five rules (about six lines of content)
  assert.equal(lines[0], '## Communication');
  assert.match(body, /balanced answers/);
  assert.match(body, /professional tone/);
  assert.equal(existsSync(join(root, '.claude/output-styles/yaw.md')), false);
  assert.equal(existsSync(join(root, '.claude/settings.json')), false);
});

test('non-default length or register: Claude output style and outputStyle setting', async () => {
  const root = await project({ extra: { 'user.length': 'brief', 'user.expertise': 'expert' } });
  assert.match(read(root, 'AGENTS.md'), /Keep answers short/);
  assert.match(read(root, 'AGENTS.md'), /user is an expert/);
  const style = read(root, '.claude/output-styles/yaw.md');
  assert.match(style, /^---\nname: YAW\n/);
  assert.match(style, /Keep answers short/);
  assert.deepEqual(readJson(root, '.claude/settings.json'), { outputStyle: 'YAW' });
  const reg = await project({ extra: { 'user.register': 'technical' } });
  assert.match(read(reg, '.claude/output-styles/yaw.md'), /precise technical terms/);
});

test('other answers (examples, explain) alone do not create an output style', async () => {
  const root = await project({ extra: { 'user.examples': 'never', 'user.explain': 'on-request' } });
  assert.match(read(root, 'AGENTS.md'), /Do not use examples/);
  assert.equal(existsSync(join(root, '.claude/output-styles/yaw.md')), false);
});

test('without Claude there is no output style, even when non-default', async () => {
  const root = await project({ agents: ['codex'], extra: { 'user.length': 'brief' } });
  assert.match(read(root, 'AGENTS.md'), /Keep answers short/);
  assert.equal(existsSync(join(root, '.claude')), false);
});

test('team mode (ADR-0013): the personal profile is not committed', async () => {
  for (const team of ['team', 'external-reviewers']) {
    const root = await project({ extra: { 'idea.team': team, 'user.length': 'brief' } });
    const agentsMd = read(root, 'AGENTS.md');
    assert.equal(section(agentsMd, 'communication'), undefined);
    assert.doesNotMatch(agentsMd, /Keep answers short/);
    assert.equal(existsSync(join(root, '.claude')), false);
    assert.match(agentsMd, /Chat in "de"/); // the project-level language rule stays (core)
    const files = readdirSync(root, { recursive: true }).join('\n');
    assert.doesNotMatch(files, /output-styles/);
    assert.equal(readManifest(root).modules.communication.enabled, true);
  }
});

test('standards: baseline plus the stack overlay of the profile, one pointer line in AGENTS.md', async () => {
  const root = await project();
  const doc = read(root, 'docs/standards.md');
  assert.match(doc, /\*\*Clean code:\*\*/);
  assert.match(doc, /\*\*Git:\*\*/);
  assert.match(doc, /## Stack notes \(node-cli - /);
  assert.match(doc, /built-ins/);
  assert.equal(section(read(root, 'AGENTS.md'), 'standards').trim().split('\n').length, 1);
});

test('every profile overlay has at most 20 lines', () => {
  for (const name of readdirSync(join(KIT_ROOT, 'profiles'))) {
    const file = join(KIT_ROOT, 'profiles', name, 'standards.md');
    if (!existsSync(file)) continue;
    const n = readFileSync(file, 'utf8').trim().split('\n').length;
    assert.ok(n <= OVERLAY_MAX_LINES, `${name}: ${n} lines`);
  }
});

test('manifest entries: owner, fragments and hashes', async () => {
  const root = await project({ extra: { 'user.length': 'brief' } });
  const m = readManifest(root);
  const byPath = Object.fromEntries(m.files.map((f) => [f.path, f]));
  assert.equal(byPath['docs/standards.md'].module, 'standards');
  assert.equal(byPath['.claude/output-styles/yaw.md'].module, 'communication');
  assert.deepEqual(byPath['AGENTS.md'].fragments.map((f) => f.module).sort(), ['communication', 'standards']);
  assert.deepEqual(byPath['.claude/settings.json'].fragments.map((f) => f.module), ['communication']);
  assert.ok(byPath["docs/standards.md"].hash);
});

test('remove leaves zero residue; answers stay; re-add restores the same files', async () => {
  const root = await project({ extra: { 'user.length': 'brief' } });
  const withBoth = readTree(root);
  await removeModule({ root, kitRoot: KIT_ROOT, module: 'communication' });
  await removeModule({ root, kitRoot: KIT_ROOT, module: 'standards' });
  const left = readTree(root);
  for (const gone of ['.claude/output-styles/yaw.md', '.claude/settings.json', 'docs/standards.md']) {
    assert.equal(Object.hasOwn(left, gone), false, gone);
  }
  assert.doesNotMatch(read(root, 'AGENTS.md'), /yaw:communication|yaw:standards|Keep answers short/);
  assert.equal(readAnswers(root).answers['user.length'], 'brief'); // user answers kept
  assert.equal(existsSync(join(root, '.yaw/base/docs')), false);
  await addModule({ root, kitRoot: KIT_ROOT, module: 'communication' });
  await addModule({ root, kitRoot: KIT_ROOT, module: 'standards' });
  assert.deepEqual(readTree(root), withBoth); // same result as before the removal
});
