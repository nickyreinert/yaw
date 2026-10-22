// yaw init pipeline (Y-3.7): collect -> confirm -> apply -> verify; the core-only footprint (Y-3 done-when).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { main } from '../core/cli/main.js';
import { readManifest } from '../core/render/manifest.js';
import { parseDocument } from '../core/lib/yaml.js';
import { KIT_ROOT, capture, fakeJust, readTree, scripted, tmp, writeAnswers } from './helpers/fixtures.js';

const EXAMPLE = join(KIT_ROOT, 'examples', 'node-cli', 'answers.yaml');
const NODE_ONLY = [dirname(process.execPath), '/usr/bin', '/bin'].join(':');

async function yaw(args, { cwd = tmp('yaw-proj-'), prompter, env = { PATH: NODE_ONLY, HOME: tmp('yaw-home-') } } = {}) {
  const stdout = capture();
  const stderr = capture();
  const p = prompter ?? { ...scripted(), interactive: false };
  const code = await main(args, { stdout, stderr, cwd, env, kitRoot: KIT_ROOT, prompter: p });
  return { code, out: stdout.text(), err: stderr.text(), cwd };
}

// Replies of a complete Quick interview for a local JavaScript tool.
const INTERVIEW = ['', '', 'en', 'skip', 'Rename photos by EXIF date.', '', 'javascript', 'local', '', ''];

test('interview: nothing is written before the confirmation; yes writes, verify is skipped on request', async () => {
  const dir = tmp('yaw-proj-');
  const prompter = scripted([...INTERVIEW, '', 'y']);
  // look at the folder at the moment the confirmation is asked
  const ask = prompter.ask;
  const seen = [];
  prompter.ask = async (question) => {
    if (/Write these files/.test(question)) seen.push(readdirSync(dir));
    return ask(question);
  };
  const r = await yaw(['init', '--skip-verify'], { cwd: dir, prompter });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(seen, [[]], 'empty folder when the question is asked');
  assert.match(r.out, /profile: node-cli \(suggested from language=javascript, runsOn=local, hosted=false, team=false\)/);
  assert.match(r.out, /^ {4}user\.autonomy +ask-risky {2}\(default\)$/m, '"skip" is listed as default');
  assert.doesNotMatch(r.out, /user\.language +en +\(default\)/);
  assert.match(r.out, /verification skipped/);
  const answers = parseDocument(readFileSync(join(dir, '.yaw/answers.yaml'), 'utf8')).value;
  assert.deepEqual(answers.answers['user.agents'], ['claude']);
  assert.equal(answers.answers['idea.text'], 'Rename photos by EXIF date.');
  assert.deepEqual(answers.proposal, {
    status: 'confirmed',
    summary: 'node-cli - Node CLI or tool, zero dependencies where possible; node --test, no Docker.',
    profiles: ['node-cli'],
    modules: ['core', 'communication', 'devenv', 'security', 'standards', 'tasks'],
  });
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /- Purpose: Rename photos by EXIF date\./);
  // Quick = core + communication + standards + devenv + tasks + security (ADR-0009): security adds .claude/settings.json and the hook shim (Claude only, no .codex/)
  assert.deepEqual(readManifest(dir).files.map((f) => f.path).filter((p) => p.startsWith('.claude/') || p.startsWith('.yaw/bin/') || p.startsWith('.codex/')), ['.claude/settings.json', '.yaw/bin/yaw-hook']);
  assert.equal(readManifest(dir).files.length, 15);
});

test('interview: declining writes nothing and exits 1', async () => {
  const dir = tmp('yaw-proj-');
  const r = await yaw(['init', '--skip-verify'], { cwd: dir, prompter: scripted([...INTERVIEW, '', 'n']) });
  assert.equal(r.code, 1);
  assert.match(r.out, /cancelled; nothing was written/);
  assert.deepEqual(readdirSync(dir), []);
});

test('interview: with no single match the user chooses the profile (by number)', async () => {
  const dir = tmp('yaw-proj-');
  const prompter = scripted(['', '', '', '', '', '', 'auto', 'auto', '', '', 'nope', '4', 'y']);
  const r = await yaw(['init', '--skip-verify'], { cwd: dir, prompter });
  assert.equal(r.code, 0, r.err);
  assert.match(prompter.shown.join(''), /No single profile matches your answers; choose one\./);
  assert.match(prompter.shown.join(''), /choose one of: node-cli, node-ts-vercel, php-web, python-cli, python-web, static-site, wordpress-plugin/);
  assert.match(r.out, /profile: python-cli \(chosen by you\)/);
  assert.ok(existsSync(join(dir, 'pyproject.toml')));
});

test('interview: input that ends early leaves the folder empty', async () => {
  const dir = tmp('yaw-proj-');
  const r = await yaw(['init'], { cwd: dir, prompter: scripted(['', '']) });
  assert.equal(r.code, 1);
  assert.match(r.err, /unexpected question|input ended/);
  assert.deepEqual(readdirSync(dir), []);
});

test('non-interactive: the same answers give identical files and hashes', async () => {
  const a = await yaw(['init', '--answers', EXAMPLE, '--yes', '--skip-verify']);
  const b = await yaw(['init', '--answers', EXAMPLE, '--yes', '--skip-verify']);
  assert.equal(a.code, 0, a.err);
  assert.equal(b.code, 0, b.err);
  assert.deepEqual(readTree(a.cwd), readTree(b.cwd));
  assert.deepEqual(readManifest(a.cwd), readManifest(b.cwd));
  assert.equal(a.out, b.out.replace(b.cwd, a.cwd));
  // the answers file is copied byte for byte (comments kept)
  assert.equal(readFileSync(join(a.cwd, '.yaw/answers.yaml'), 'utf8'), readFileSync(EXAMPLE, 'utf8'));
});

test('core-only footprint: a handful of files (Y-3 done-when)', async () => {
  for (const profile of ['node-cli', 'python-cli']) {
    const r = await yaw(['init', '--answers', join(KIT_ROOT, 'examples', profile, 'answers.yaml'), '--yes', '--skip-verify']);
    assert.equal(r.code, 0, r.err);
    const files = Object.keys(readTree(r.cwd)).filter((p) => !p.startsWith('.yaw/base/'));
    assert.ok(files.length <= 12, `${profile}: ${files.length} files: ${files.join(', ')}`);
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'justfile', '.yaw/manifest.json', '.yaw/answers.yaml']) assert.ok(files.includes(f), f);
    const manifest = readManifest(r.cwd);
    // every file but the base copies is in the manifest, with its hash
    assert.deepEqual(manifest.files.map((f) => f.path).sort(), [...files.filter((p) => p !== '.yaw/manifest.json')].sort());
  }
});

test('Quick footprint, complete after Y-5.3 (ADR-0009, ADR-0010): 16 files for Claude, 17 with Codex', async () => {
  for (const [agents, count] of [['claude', 16], ['claude, codex', 17]]) {
    const text = `mode: quick\nanswers:\n  user.agents: [${agents}]\n  arch.language: javascript\n  arch.runs-on: local\n`;
    const r = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), text), '--yes', '--skip-verify']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /modules: core, communication, devenv, security, standards, tasks/);
    const files = Object.keys(readTree(r.cwd)).filter((p) => !p.startsWith('.yaw/base/'));
    assert.equal(files.length, count, files.join(', '));
  }
});

test('answers without a proposal: the profile is suggested from the answers and written back', async () => {
  const text = 'mode: quick\nanswers:\n  user.agents: [codex]\n  arch.language: python\n  arch.runs-on: local\n';
  const r = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), text), '--yes', '--skip-verify']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /profile: python-cli \(suggested from language=python, runsOn=local, hosted=false\)/);
  assert.match(r.out, /user\.language +de +\(default\)/, 'questions missing from the file are listed as default');
  const doc = parseDocument(readFileSync(join(r.cwd, '.yaw/answers.yaml'), 'utf8')).value;
  assert.deepEqual(doc.proposal.profiles, ['python-cli']);
  assert.match(readFileSync(join(r.cwd, 'AGENTS.md'), 'utf8'), /Chat in "de"/);
  assert.deepEqual(readManifest(r.cwd).agents, ['codex']);
});

test('answers without a proposal and without a clear match are refused before anything is written', async () => {
  const text = 'mode: quick\nanswers:\n  user.agents: [claude]\n';
  const r = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), text), '--yes', '--skip-verify']);
  assert.equal(r.code, 1);
  assert.match(r.err, /no single profile matches \(no facts known\); add proposal\.profiles/);
  assert.deepEqual(readdirSync(r.cwd), []);
});

test('an unknown profile and several profiles are refused with the choices', async () => {
  const body = (profiles) => `mode: quick\nanswers:\n  user.agents: [claude]\nproposal:\n  status: confirmed\n  summary: x\n  profiles: [${profiles}]\n  modules: [core]\n`;
  const unknown = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), body('go-cli')), '--yes', '--skip-verify']);
  assert.match(unknown.err, /profile "go-cli" does not exist in this kit \(available: node-cli, node-ts-vercel, php-web, python-cli, python-web, static-site, wordpress-plugin\)/);
  const several = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), body('node-cli, python-cli')), '--yes', '--skip-verify']);
  assert.match(several.err, /several profiles \(node-cli, python-cli\) come with composition/);
  assert.deepEqual(readdirSync(several.cwd), []);
});

test('modules the kit does not have yet are skipped with a note', async () => {
  const text = readFileSync(EXAMPLE, 'utf8').replace('modules: [core]', 'modules: [core, knowledge]');
  const r = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), text), '--yes', '--skip-verify']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /note: module "knowledge" is not in this kit yet; skipped/);
  assert.deepEqual(Object.keys(readManifest(r.cwd).modules), ['core']);
});

test('init refuses a project that already has a manifest, before it asks anything', async () => {
  const first = await yaw(['init', '--answers', EXAMPLE, '--yes', '--skip-verify']);
  const prompter = scripted();
  const second = await yaw(['init', '--skip-verify'], { cwd: first.cwd, prompter });
  assert.equal(second.code, 1);
  assert.match(second.err, /already exists; use yaw update/);
  assert.deepEqual(prompter.asked, []);
});

test('verify runs just setup, then just check, in the project folder', async () => {
  const bin = tmp('yaw-bin-');
  const log = fakeJust(bin);
  const r = await yaw(['init', '--answers', EXAMPLE, '--yes'], { env: { PATH: `${bin}:${NODE_ONLY}`, HOME: tmp('yaw-home-') } });
  assert.equal(r.code, 0, r.err);
  const calls = readFileSync(log, 'utf8').trim().split('\n');
  assert.deepEqual(calls.map((c) => c.split(' ').slice(1).join(' ')), ['setup', 'check']);
  assert.ok(calls.every((c) => c.startsWith(`${realpathSync(r.cwd)} `)), 'runs in the project folder');
  assert.match(r.out, /verified: just setup and just check passed/);
});

test('verify failure: files stay, exit 1, the message names the recipe', async () => {
  const bin = tmp('yaw-bin-');
  fakeJust(bin, { code: 3 });
  const r = await yaw(['init', '--answers', EXAMPLE, '--yes'], { env: { PATH: `${bin}:${NODE_ONLY}`, HOME: tmp('yaw-home-') } });
  assert.equal(r.code, 1);
  assert.match(r.err, /just setup failed \(exit 3\); the files are written/);
  assert.ok(existsSync(join(r.cwd, 'AGENTS.md')));
  assert.doesNotMatch(r.out, /verified:/);
});

test('verify without just: files stay, exit 1, install hint', async () => {
  const r = await yaw(['init', '--answers', EXAMPLE, '--yes']);
  assert.equal(r.code, 1);
  assert.match(r.err, /just is not installed, so the project could not be verified/);
  assert.ok(existsSync(join(r.cwd, '.yaw/manifest.json')));
});
