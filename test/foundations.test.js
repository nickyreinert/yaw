import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../core/cli/main.js';
import { parseKickoffReply, parsePlan } from '../core/lib/kickoff.js';
import { FOUNDATION_INDEX, FOUNDATION_PATHS, assertFoundationsUnchanged, checkTaskReferences, foundationContext, prepareFoundations, readFoundationFile, saveFoundations } from '../core/lib/foundations.js';
import { readManifest } from '../core/render/manifest.js';
import { createFormApi } from '../core/web/init.js';
import { parseTasks, renderTasks } from '../core/lib/tasks.js';
import { startTask } from '../modules/tasks/lib/ledger.js';
import { issueBody, viewFromIssues } from '../modules/tasks/lib/github.js';
import { buildPrompt } from '../modules/review/lib/cli.js';
import { KIT_ROOT, capture, scripted, tmp, writeTree } from './helpers/fixtures.js';

async function yaw(root, args) {
  const stdout = capture(), stderr = capture();
  const code = await main(args, { cwd: root, kitRoot: KIT_ROOT, stdout, stderr,
    env: { PATH: process.env.PATH, HOME: tmp('yaw-foundation-home-'), YAW_TEST_OFFLINE: '1' }, prompter: { ...scripted(), interactive: false } });
  return { code, out: stdout.text(), err: stderr.text() };
}
async function project() {
  const root = tmp('yaw-foundations-');
  const file = join(tmp(), 'answers.yaml');
  writeFileSync(file, readFileSync(join(KIT_ROOT, 'examples/node-cli/answers.yaml'), 'utf8').replace('modules: [core]', 'modules: [core, tasks]'));
  const result = await yaw(root, ['init', '--answers', file, '--yes', '--skip-verify']);
  assert.equal(result.code, 0, result.err);
  return root;
}
function bundle(bodies, paths = FOUNDATION_PATHS, reuse = false) {
  return ['# Plan: Example', 'kickoff-format: 1', ...Object.keys(FOUNDATION_PATHS).flatMap((kind) => [
    `## Foundation: ${kind}`, `path: ${paths[kind]}`, `action: ${reuse ? 'reuse' : 'create'}`,
    ...(reuse ? [] : ['```markdown', `# ${kind}`, bodies[kind], '```']),
  ]), '## Phase 1: First slice', '- [ ] Implement the main task', `  spec: ${paths.architecture}#architecture`,
  '  acceptance: The agreed main task succeeds and its failure case preserves data.', ''].join('\n');
}
const CLI = { architecture: 'One local renamer. Never replace an existing target.', 'data-model': 'No persistent application data. Map input paths to unique output paths.', 'ui-ux': 'Preview names. Confirm changes. Explain collisions without changing files.' };
const SITE = { architecture: 'Static opening-hours site. Content is maintained by its owner.', 'data-model': 'No application database. Versioned opening hours and contact details.', 'ui-ux': 'Visitors find current hours by keyboard and phone. Show a readable fallback when maps fail.' };
const APP = { architecture: 'Booking service. Only eligible members can reserve an available slot.', 'data-model': 'Bookings belong to members. A slot has at most one live booking. Authorize reads and writes; document retention.', 'ui-ux': 'Choose a slot, confirm, see success. Explain a concurrent reservation and offer another slot.' };

for (const [name, bodies] of [['tiny CLI', CLI], ['static site', SITE], ['data-backed app', APP]]) {
  test(`${name}: dry-run previews, explicit review imports, context and task traceability survive update`, async () => {
    const root = await project();
    assert.equal(existsSync(join(root, FOUNDATION_INDEX)), false, 'baseline creates no foundation artifacts');
    writeFileSync(join(root, 'plan.md'), bundle(bodies));
    const dry = await yaw(root, ['kickoff', 'import', 'plan.md', '--dry-run']);
    assert.equal(dry.code, 0, dry.err);
    assert.match(dry.out, /Foundation architecture/);
    assert.equal(existsSync(join(root, FOUNDATION_INDEX)), false);
    const refused = await yaw(root, ['kickoff', 'import', 'plan.md']);
    assert.match(refused.err, /Review all three foundations/);
    assert.equal(existsSync(join(root, FOUNDATION_INDEX)), false);
    const imported = await yaw(root, ['kickoff', 'import', 'plan.md', '--reviewed']);
    assert.equal(imported.code, 0, imported.err);
    for (const [kind, path] of Object.entries(FOUNDATION_PATHS)) assert.match(readFileSync(join(root, path), 'utf8'), new RegExp(bodies[kind].split('.')[0]));
    const context = await yaw(root, ['kickoff', 'context', '--json']);
    assert.equal(context.code, 0, context.err);
    const data = JSON.parse(context.out);
    assert.equal(data.documents.length, 3);
    assert.match(data.practices, /Project scope:.*Kit scope:/s);
    assert.ok(data.documents.every((d) => !d.changed));
    const ledger = parseTasks(readFileSync(join(root, 'TASKS.md'), 'utf8'));
    const item = ledger.backlog.find((t) => t.title === 'Implement the main task');
    assert.equal(item.spec, 'docs/spec/architecture.md#architecture');
    assert.match(item.acceptance, /preserves data/);
    assert.deepEqual(parseTasks(renderTasks(ledger)), ledger);
    const active = startTask(ledger, item.id);
    assert.equal(active.spec, item.spec);
    assert.equal(active.brief, item.acceptance);
    const manifest = readManifest(root);
    assert.ok(manifest.files.filter((f) => [...Object.values(FOUNDATION_PATHS), FOUNDATION_INDEX].includes(f.path)).every((f) => !f.managed));
    const changed = `${readFileSync(join(root, FOUNDATION_PATHS.architecture), 'utf8')}\nAn agreed new constraint.\n`;
    writeFileSync(join(root, FOUNDATION_PATHS.architecture), changed);
    assert.ok(foundationContext({ root }).warnings.some((w) => /changed since kickoff review/.test(w)));
    const update = await yaw(root, ['update']);
    assert.equal(update.code, 0, update.err);
    assert.equal(readFileSync(join(root, FOUNDATION_PATHS.architecture), 'utf8'), changed);
    const ux = await yaw(root, ['kickoff', 'ux']);
    assert.match(ux.out, /Optional UI\/UX guidance/);
    assert.match(ux.out, /An agreed new constraint/);
  });
}

test('existing repository: reuse chosen authoritative paths, include them in reviewers, never copy or replace them', async () => {
  const root = await project();
  const paths = { architecture: 'design/system.md', 'data-model': 'design/contracts.md', 'ui-ux': 'design/interaction.md' };
  writeTree(root, Object.fromEntries(Object.entries(paths).map(([kind, path]) => [path, `# ${kind}\n${APP[kind]}\n`])));
  const reply = parseKickoffReply(bundle(APP, paths, true));
  const prepared = prepareFoundations({ root, documents: reply.foundations, reviewed: true });
  checkTaskReferences(reply.tasks, prepared);
  saveFoundations({ root, prepared });
  assert.equal(existsSync(join(root, FOUNDATION_PATHS.architecture)), false);
  for (const kind of ['quality', 'logic', 'ux', 'feature']) {
    const prompt = buildPrompt({ root, kind, range: 'a..b', diff: '+x', env: { HOME: tmp() } });
    assert.match(prompt, /YAW generic practices/);
    assert.match(prompt, /design\/contracts.md/);
    assert.match(prompt, /Only eligible members/);
    assert.match(prompt, /never silently rewrite an explicit project rule/);
  }
});

test('foundation protocol: documents cannot become tasks; incomplete, unknown and untraceable bundles fail', () => {
  const text = bundle({ ...CLI, architecture: '## Idea\n- [ ] This is a domain rule, not a task.\n## architecture\nPreserve files.' });
  assert.equal(parseKickoffReply(text).tasks.length, 1);
  assert.equal(parsePlan(text).length, 1);
  assert.throws(() => parseKickoffReply(text.replace('kickoff-format: 1', 'kickoff-format: 99')), /kickoff-format/);
  assert.throws(() => parseKickoffReply(text.replace('## Foundation: ui-ux', '## Foundation: unknown')), /all three foundations/);
  assert.throws(() => parseKickoffReply(text.replace('  acceptance:', '  outcome:')), /acceptance/);
  assert.throws(() => parseKickoffReply(text + '\n## Phase 2: Bad\nmodel: opus · effort: huge\n- [ ] Bad\n'), /effort/);
  assert.equal(parseKickoffReply('## Phase 1: Legacy\n- [ ] Still works').foundations.length, 0);
  const nested = text.replaceAll('```markdown', '````markdown').replaceAll('\n```\n', '\n````\n')
    .replace('Preserve files.', 'Preserve files.\n```sh\n## Phase 9: A code example\n- [ ] Not a task\n```');
  assert.equal(parseKickoffReply(nested).tasks.length, 1);
  assert.match(parseKickoffReply(nested).foundations[0].text, /```sh/);
});

test('preflight rejects overwrite, missing sources, broken task anchors, secret paths, oversized files and symlinks', () => {
  const root = tmp();
  const documents = parseKickoffReply(bundle(CLI)).foundations;
  writeTree(root, { [FOUNDATION_PATHS.architecture]: '# Existing user rules\nDo not overwrite.\n' });
  assert.throws(() => prepareFoundations({ root, documents, reviewed: true }), /already exists/);
  const fresh = tmp();
  const prepared = prepareFoundations({ root: fresh, documents, reviewed: true });
  assert.throws(() => checkTaskReferences([{ title: 'Broken', spec: `${FOUNDATION_PATHS.architecture}#missing`, acceptance: 'Observe it.' }], prepared), /section #missing/);
  const changed = structuredClone(documents); changed[0].path = '../outside.md';
  assert.throws(() => prepareFoundations({ root: fresh, documents: changed, reviewed: true }), /escapes/);
  assert.throws(() => readFoundationFile(fresh, '.env'), /non-secret/);
  assert.throws(() => prepareFoundations({ root: fresh, documents: documents.map((d) => ({ ...d, action: 'reuse', text: undefined })), reviewed: true }), /existing document/);
  writeFileSync(join(fresh, 'large.md'), 'x'.repeat(100001));
  assert.throws(() => readFoundationFile(fresh, 'large.md'), /100,000/);
  symlinkSync(root, join(fresh, 'linked'), 'dir');
  assert.throws(() => readFoundationFile(fresh, 'linked/anything.md'), /symbolic links/);
  writeTree(fresh, { [FOUNDATION_PATHS.architecture]: 'Changed after review.' });
  assert.throws(() => assertFoundationsUnchanged(fresh, prepared), /changed since review/);
  assert.equal(existsSync(join(fresh, FOUNDATION_PATHS['data-model'])), false);
});

test('browser: exact foundation preview and acknowledgement precede Apply; changed reused sources are rejected', async () => {
  const root = tmp(), env = { HOME: tmp(), YAW_TEST_OFFLINE: '1' };
  const api = createFormApi({ root, kitRoot: KIT_ROOT, env, skipVerify: true });
  const plan = bundle(CLI);
  const preview = await api.action('kickoff-reply', { text: plan });
  assert.equal(preview.foundations.length, 3);
  const input = { mode: 'quick', modules: ['core', 'tasks'], answers: { 'idea.text': 'Rename photos.', 'arch.language': 'javascript', 'arch.runs-on': 'local' }, plan };
  assert.throws(() => api.prepareApply(input), /Review all three foundations/);
  assert.throws(() => api.prepareApply({ ...input, foundationsReviewed: true }), /not previewed/);
  const prepared = api.prepareApply({ ...input, foundationsReviewed: true, foundationReview: preview.foundationReview });
  const events = [];
  await api.apply(prepared, (e) => events.push(e));
  assert.ok(events.some((e) => e.type === 'done' && e.ok));
  assert.equal(foundationContext({ root }).documents.length, 3);
  assert.ok(readManifest(root).files.find((f) => f.path === 'docs/plan/kickoff.md' && !f.managed));
  api.close();
  const existing = tmp();
  writeTree(existing, Object.fromEntries(Object.entries(FOUNDATION_PATHS).map(([kind, path]) => [path, `# ${kind}\n${CLI[kind]}\n`])));
  const second = createFormApi({ root: existing, kitRoot: KIT_ROOT, env, skipVerify: true });
  const reuse = bundle(CLI, FOUNDATION_PATHS, true);
  const old = await second.action('kickoff-reply', { text: reuse });
  writeFileSync(join(existing, FOUNDATION_PATHS.architecture), '# architecture\nNew rule.\n');
  assert.throws(() => second.prepareApply({ ...input, plan: reuse, foundationsReviewed: true, foundationReview: old.foundationReview }), /changed or were not previewed/);
  assert.equal(existsSync(join(existing, '.yaw/manifest.json')), false);
  second.close();
});

test('GitHub task views and mirroring retain specification links and acceptance outcomes', () => {
  const task = { id: 'T-001', title: 'Build it', spec: 'design/system.md#architecture', acceptance: 'Members can reserve an available slot.' };
  const body = issueBody(task);
  const issue = { number: 1, title: task.title, body, labels: [], comments: [] };
  const backlog = viewFromIssues({ mine: [], open: [issue], owner: 'owner' }).backlog[0];
  assert.equal(backlog.spec, task.spec); assert.equal(backlog.acceptance, task.acceptance);
  const active = viewFromIssues({ mine: [issue], open: [issue], owner: 'owner' }).active[0];
  assert.equal(active.spec, task.spec); assert.equal(active.brief, task.acceptance);
});

test('core-only projects can review foundations without installing a task store', async () => {
  const root = tmp();
  const init = await yaw(root, ['init', '--answers', join(KIT_ROOT, 'examples/node-cli/answers.yaml'), '--yes', '--skip-verify']);
  assert.equal(init.code, 0, init.err);
  writeFileSync(join(root, 'plan.md'), bundle(CLI));
  const result = await yaw(root, ['kickoff', 'import', 'plan.md', '--reviewed']);
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /saved reviewed foundations; tasks remain/);
  assert.equal(foundationContext({ root }).documents.length, 3);
  assert.equal(existsSync(join(root, 'TASKS.md')), false);
});

test('unsafe or malformed inputs fail before writes or browser source previews', async () => {
  const root = tmp();
  const docs = parseKickoffReply(bundle(CLI)).foundations;
  docs[2].text = `example ${'sk-'}${'a1b2c3d4'.repeat(5)}`;
  assert.throws(() => prepareFoundations({ root, documents: docs, reviewed: true }), /unsafe foundation/);
  assert.equal(existsSync(join(root, FOUNDATION_PATHS.architecture)), false);
  const api = createFormApi({ root, kitRoot: KIT_ROOT, env: { HOME: tmp() }, skipVerify: true });
  await assert.rejects(api.action('kickoff-reply', { text: `## Phase 1: X\n- [ ] Example ${'sk-'}${'a1b2c3d4'.repeat(5)}` }), /secret/i);
  api.close();
  writeTree(root, { [FOUNDATION_INDEX]: 'null' });
  assert.throws(() => foundationContext({ root }), /Invalid foundation index/);
  const linked = tmp();
  writeTree(linked, { 'other.md': 'A regular file.', '.yaw/placeholder.md': 'A folder fixture.' });
  symlinkSync(join(linked, 'other.md'), join(linked, '.yaw/answers.yaml'));
  assert.throws(() => foundationContext({ root: linked }), /symbolic links/);
});
