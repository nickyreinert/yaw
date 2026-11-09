// communication + standards (Y-5.1, ADR-0013, ADR-0024): rendering from the profile, output style only when
// non-default, team-mode rule, overlay limit, removal with zero residue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from '../../../core/render/manifest.js';
import { initProject, readAnswers, removeModule, addModule } from '../../../core/render/project.js';
import { OVERLAY_MAX_LINES } from '../../../core/render/kit.js';
import { collectQuestions } from '../../../core/render/kit.js';
import { KIT_ROOT, read, readJson, readTree, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';

const MODULES = ['core', 'communication'];

// T-027: the style is personal unless the project switches it to team; most tests render a shared style.
const STYLE = ['user.length', 'user.explain', 'user.expertise', 'user.language', 'user.autonomy'];
function answers({ agents = ['claude', 'codex', 'copilot'], extra = {}, profile = 'node-cli', shared = true } = {}) {
  const lines = ['mode: quick', 'answers:', `  user.agents: [${agents.join(', ')}]`, '  idea.text: A tiny command-line tool.'];
  for (const [k, v] of Object.entries(extra)) lines.push(`  ${k}: ${v}`);
  if (shared) lines.push('scopes:', ...STYLE.map((id) => `  ${id}: team`));
  lines.push('proposal:', '  status: confirmed', '  summary: test project', `  profiles: [${profile}]`, `  modules: [${MODULES.join(', ')}]`);
  return `${lines.join('\n')}\n`;
}

async function project(opts = {}) {
  const root = tmp('yaw-comm-');
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-ans-'), answers(opts)), modules: MODULES });
  return root;
}

const section = (text, module) => text.match(new RegExp(`<!-- yaw:${module} -->\\n([\\s\\S]*?)<!-- /yaw:${module} -->`))?.[1];

test('default profile: four lines in AGENTS.md, no output style, no settings entry', async () => {
  const root = await project();
  const body = section(read(root, 'AGENTS.md'), 'communication');
  const lines = body.trim().split('\n');
  assert.equal(lines.length, 4); // heading, blank line, five rules on two lines
  assert.equal(lines[0], '## Communication');
  assert.match(body, /balanced answers/);
  assert.match(body, /professional tone/);
  assert.equal(existsSync(join(root, '.claude/output-styles/yaw.md')), false);
  assert.equal(existsSync(join(root, '.claude/settings.json')), false);
});

test('non-default length or register: Claude output style and outputStyle setting', async () => {
  const root = await project({ extra: { 'user.length': 'brief', 'user.expertise': 'expert' } });
  assert.match(read(root, 'AGENTS.md'), /Prefer bullet points, key points and direct answers\. Avoid unnecessary explanations\./);
  assert.match(read(root, 'AGENTS.md'), /user is an expert/);
  const style = read(root, '.claude/output-styles/yaw.md');
  assert.match(style, /^---\nname: YAW\n/);
  assert.match(style, /Prefer bullet points/);
  assert.deepEqual(readJson(root, '.claude/settings.json'), { outputStyle: 'YAW' });
  const reg = await project({ extra: { 'user.expertise': 'expert' } });
  assert.match(read(reg, '.claude/output-styles/yaw.md'), /precise technical terms/);
});

test('wording and examples follow the experience level; no separate questions remain', async () => {
  const ids = collectQuestions(KIT_ROOT, ['core', 'communication']).map((q) => q.id);
  assert.equal(ids.includes('user.register'), false);
  assert.equal(ids.includes('user.examples'), false);
  const lay = read(await project({ extra: { 'user.expertise': 'layperson' } }), 'AGENTS.md');
  assert.match(lay, /plain words/);
  assert.match(lay, /Illustrate every explanation/);
  const mid = read(await project({ extra: { 'user.expertise': 'intermediate' } }), 'AGENTS.md');
  assert.match(mid, /professional tone/);
  assert.match(mid, /examples or analogies when they help/);
  const expert = read(await project({ extra: { 'user.expertise': 'expert' } }), 'AGENTS.md');
  assert.match(expert, /precise technical terms/);
  assert.match(expert, /Do not use examples or analogies unless asked/);
});

test('Communication Style questions are labelled by topic', () => {
  const labels = Object.fromEntries(collectQuestions(KIT_ROOT, ['core', 'communication']).map((q) => [q.id, q.label]));
  assert.equal(labels['user.autonomy'], 'Frequency: How often should the agent ask before acting?');
  assert.equal(labels['user.length'], 'Depth: How long should answers be?');
  assert.equal(labels['user.explain'], 'Response: Should the agent explain its actions?');
});

test('the response answer alone does not create an output style', async () => {
  const root = await project({ extra: { 'user.explain': 'on-request' } });
  assert.match(read(root, 'AGENTS.md'), /only when asked/);
  assert.equal(existsSync(join(root, '.claude/output-styles/yaw.md')), false);
});

test('without Claude there is no output style, even when non-default', async () => {
  const root = await project({ agents: ['codex'], extra: { 'user.length': 'brief' } });
  assert.match(read(root, 'AGENTS.md'), /Prefer bullet points/);
  assert.equal(existsSync(join(root, '.claude')), false);
});

test('personal by default (ADR-0013, T-027): the style is not committed, solo or team', async () => {
  for (const team of ['solo', 'team']) {
    const root = await project({ shared: false, extra: { 'idea.team': team, 'user.length': 'brief' } });
    const agentsMd = read(root, 'AGENTS.md');
    assert.equal(section(agentsMd, 'communication'), undefined);
    assert.doesNotMatch(agentsMd, /Prefer bullet points/);
    assert.equal(existsSync(join(root, '.claude')), false);
    assert.doesNotMatch(agentsMd, /Chat in "de"|Ask before risky/);
    assert.match(agentsMd, /chat language, autonomy and answer style are each person's own settings/);
    const files = readdirSync(root, { recursive: true }).join('\n');
    assert.doesNotMatch(files, /output-styles/);
    assert.equal(readManifest(root).modules.communication.enabled, true);
  }
});

test('engineering rules: clean code, git style and the stack overlay of the profile, no standards file (T-030)', async () => {
  const root = await project();
  const doc = read(root, 'docs/engineering.md');
  assert.match(doc, /small, focused units/);
  assert.match(doc, /Conventional Commits/);
  assert.match(doc, /## Stack rules/);
  assert.match(doc, /built-ins/);
  assert.equal(existsSync(join(root, 'docs/standards.md')), false);
  assert.doesNotMatch(read(root, 'AGENTS.md'), /yaw:standards|docs\/standards\.md/);
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
  assert.equal(byPath['docs/engineering.md'].module, 'core');
  assert.equal(byPath['.claude/output-styles/yaw.md'].module, 'communication');
  assert.deepEqual(byPath['AGENTS.md'].fragments.map((f) => f.module).sort(), ['communication']);
  assert.deepEqual(byPath['.claude/settings.json'].fragments.map((f) => f.module), ['communication']);
  assert.ok(byPath['docs/engineering.md'].hash);
});

test('removing communication removes optional artifacts, keeps core preferences and re-add restores the same files', async () => {
  const root = await project({ extra: { 'user.length': 'brief' } });
  const withBoth = readTree(root);
  await removeModule({ root, kitRoot: KIT_ROOT, module: 'communication' });
  const left = readTree(root);
  for (const gone of ['.claude/output-styles/yaw.md', '.claude/settings.json']) {
    assert.equal(Object.hasOwn(left, gone), false, gone);
  }
  assert.doesNotMatch(read(root, 'AGENTS.md'), /yaw:communication/);
  assert.match(read(root, 'AGENTS.md'), /Prefer bullet points/, 'core still applies personal preferences without an optional output style');
  assert.equal(readAnswers(root).answers['user.length'], 'brief'); // user answers kept
  assert.equal(existsSync(join(root, '.yaw/base/docs/engineering.md')), true, 'core engineering baseline survives removing optional modules');
  await addModule({ root, kitRoot: KIT_ROOT, module: 'communication' });
  assert.deepEqual(readTree(root), withBoth); // same result as before the removal
});
