// yaw init pipeline (Y-3.7): collect -> confirm -> apply -> verify; the core-only footprint (Y-3 done-when).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { main } from '../core/cli/main.js';
import { readManifest } from '../core/render/manifest.js';
import { parseDocument } from '../core/lib/yaml.js';
import { saveSetup } from '../core/lib/user-store.js';
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

// Replies of a complete Quick interview (setup depth first) for a local JavaScript tool.
const INTERVIEW = ['', '', 'Rename photos by EXIF date.', 'typescript', 'local', 'n'];

function previousSetup(mode = 'quick') {
  const env = { PATH: NODE_ONLY, HOME: tmp('yaw-home-') };
  const doc = parseDocument(readFileSync(EXAMPLE, 'utf8')).value;
  const answers = { ...doc.answers, 'user.agents': ['codex'], 'idea.text': 'Saved project idea.' };
  const saved = saveSetup({ env, kitRoot: KIT_ROOT, answers, mode, projectRoot: tmp('previous-project-'), kit: '0.1.0', preset: true, profile: false });
  return { env, answers, file: join(saved.dir, 'presets', `${saved.preset}.yaml`) };
}

test('init: p loads a saved setup as editable defaults, asks before writing and preserves the source', async () => {
  const { env, file } = previousSetup();
  const source = readFileSync(file, 'utf8');
  const dir = tmp('yaw-proj-');
  const prompter = scripted();
  prompter.ask = async (question) => {
    prompter.asked.push(question);
    if (/Setup depth/.test(question)) return 'p';
    if (/\[Saved project idea\.\]/.test(question)) return 'A new project idea.';
    if (/Write these files/.test(question)) {
      assert.deepEqual(readdirSync(dir), []);
      return 'y';
    }
    if (/Save |Kick off the project documents/.test(question)) return 'n';
    return '';
  };
  const r = await yaw(['init', '--skip-verify'], { cwd: dir, env, prompter });
  assert.equal(r.code, 0, r.err);
  const doc = parseDocument(readFileSync(join(dir, '.yaw/answers.yaml'), 'utf8')).value;
  assert.equal(doc.mode, 'quick');
  assert.equal(doc.answers['idea.text'], 'A new project idea.');
  assert.deepEqual(doc.answers['user.agents'], ['codex']);
  assert.equal(readFileSync(file, 'utf8'), source);
  assert.match(prompter.shown.join(''), /p\) Load a previous setup/);
  assert.match(prompter.shown.join(''), /Saved answers are defaults/);
  assert.ok(prompter.shown.join('').includes('Which coding agents'));
});

test('init: a saved Full setup keeps its mode and can be declined without any writes', async () => {
  const { env } = previousSetup('full');
  const dir = tmp('yaw-proj-');
  const prompter = scripted();
  prompter.ask = async (question) => {
    if (/Setup depth/.test(question)) return 'p';
    if (/Write these files/.test(question)) return 'n';
    return '';
  };
  const r = await yaw(['init', '--skip-verify'], { cwd: dir, env, prompter });
  assert.equal(r.code, 1, r.err);
  assert.match(prompter.shown.join(''), /\(All\)\. Saved answers/);
  assert.match(r.out, /cancelled; nothing was written/);
  assert.deepEqual(readdirSync(dir), []);
});

test('init: no presets explains how to save or copy a setup and returns to setup depth', async () => {
  const dir = tmp('yaw-proj-');
  const prompter = scripted(['p', ...INTERVIEW, '', 'n']);
  const r = await yaw(['init', '--skip-verify'], { cwd: dir, prompter });
  assert.equal(r.code, 1, r.err);
  assert.match(prompter.shown.join(''), /No saved setups yet/);
  assert.match(prompter.shown.join(''), /yaw init --answers \/path\/to\/project\/\.yaw\/answers\.yaml/);
  assert.deepEqual(readdirSync(dir), []);
});

test('init: previous setup picker supports back and never displays invalid preset answers', async () => {
  const { env, file } = previousSetup();
  const prompter = scripted(['p', 'b', ...INTERVIEW, '', 'n']);
  const dir = tmp('yaw-proj-');
  assert.equal((await yaw(['init', '--skip-verify'], { cwd: dir, env, prompter })).code, 1);
  assert.deepEqual(readdirSync(dir), []);
  const canary = `ghp_${'a'.repeat(36)}`;
  writeFileSync(file, readFileSync(file, 'utf8').replace('Saved project idea.', canary));
  const invalid = scripted(['p', '']);
  const r = await yaw(['init'], { cwd: dir, env, prompter: invalid });
  assert.equal(r.code, 1);
  assert.match(r.err, /looks like a secret/);
  assert.ok(!`${r.out}${r.err}${invalid.shown.join('')}`.includes(canary));
  assert.deepEqual(readdirSync(dir), []);
});

test('init: browser handoff retains unreviewed saved defaults and newly edited answers', async () => {
  const { env, answers } = previousSetup();
  const dir = tmp('yaw-proj-');
  const stdout = capture();
  let url;
  const running = main(['init', '--skip-verify'], {
    cwd: dir, env, kitRoot: KIT_ROOT, stdout, stderr: capture(), prompter: scripted(['p', '1', 'w']),
    openBrowser: async (u) => { url = u; return true; },
  });
  try {
    for (let i = 0; i < 100 && !url; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(url, stdout.text());
    const login = await fetch(url, { redirect: 'manual' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const boot = await (await fetch(new URL('/api/bootstrap', url), { headers: { cookie } })).json();
    assert.equal(boot.handoff.mode, 'quick');
    for (const [id, value] of Object.entries(answers)) assert.deepEqual(boot.handoff.answers[id], value);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    process.emit('SIGINT');
    await running;
  }
});

test('interview: nothing is written before the confirmation; yes writes, verify is skipped on request', async () => {
  const dir = tmp('yaw-proj-');
  const prompter = scripted([...INTERVIEW, 'y', '', '2']);
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
  assert.match(r.out, /profile: node-cli \(typescript on local\)/);
  assert.match(r.out, /^ {4}user\.autonomy +ask-risky {2}\(documented default\)$/m);
  assert.match(r.out, /user\.language +de +\(documented default\)/);
  assert.match(r.out, /verification skipped/);
  const answers = parseDocument(readFileSync(join(dir, '.yaw/answers.yaml'), 'utf8')).value;
  assert.deepEqual(answers.answers['user.agents'], ['claude']);
  assert.equal(answers.answers['idea.text'], 'Rename photos by EXIF date.');
  assert.deepEqual(answers.proposal, {
    status: 'confirmed',
    summary: 'node-cli - Node CLI or tool, zero dependencies where possible; node --test, no Docker.',
    profiles: ['node-cli'],
    modules: ['core'],
  });
  assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /- Purpose: Rename photos by EXIF date\./);
  // Quick = core + communication + standards + devenv + tasks + security + sessions (ADR-0009, ADR-0054): security adds .claude/settings.json and the hook shim, sessions the handoff skill (Claude only, no .codex/)
  assert.deepEqual(readManifest(dir).files.map((f) => f.path).filter((p) => p.startsWith('.claude/') || p.startsWith('.yaw/bin/') || p.startsWith('.codex/')), []);
  assert.equal(readManifest(dir).files.length, 11);
  assert.match(r.out, /README\.md {2}\(your idea; an existing README gets an "Idea" section\)/);
  // kickoff (#173): asked last; the same two choices as the browser's Finished step, written to a file, not printed
  assert.match(prompter.asked.at(-1), /Kick off the project documents/);
  assert.match(r.out, /1\) I already have a concept: a prompt for the chat that holds it \(\.yaw\/concept-prompt\.md\)\n {2}2\) Let my coding agent write them/);
  assert.match(r.out, /Wrote the prompt for your coding agent to \.yaw\/kickoff-prompt\.md\./);
  assert.doesNotMatch(r.out, /Set up the project foundations/);
  assert.match(readFileSync(join(dir, '.yaw/kickoff-prompt.md'), 'utf8'), /^Set up the project foundations[\s\S]*Rename photos by EXIF date\./);
  assert.equal(existsSync(join(dir, '.yaw/concept-prompt.md')), false);
});

test('interview: declining writes nothing and exits 1', async () => {
  const dir = tmp('yaw-proj-');
  const r = await yaw(['init', '--skip-verify'], { cwd: dir, prompter: scripted([...INTERVIEW, 'n']) });
  assert.equal(r.code, 1);
  assert.match(r.out, /cancelled; nothing was written/);
  assert.deepEqual(readdirSync(dir), []);
});

test('interview: an uncovered combination offers available YAW profiles (by number)', async () => {
  const dir = tmp('yaw-proj-');
  const prompter = scripted(['', '', 'A static site.', 'html', 'wordpress', 'n', '', '', '', '', '', 'nope', '1', 'y', '', '', 'n']);
  const r = await yaw(['init', '--skip-verify'], { cwd: dir, prompter });
  assert.equal(r.code, 0, r.err);
  assert.match(prompter.shown.join(''), /No YAW profile for HTML, CSS & JavaScript on wordpress/);
  assert.match(prompter.shown.join(''), /choose one of: local, self-hosted, serverless, edge, static/);
  assert.match(r.out, /profile: static-site \(html on local\)/);
  assert.match(prompter.shown.join(''), /Preview public\/ on your computer/);
  assert.ok(existsSync(join(dir, 'public')));
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

test('Quick answers-only footprint includes a README for the required purpose', async () => {
  for (const [agents, count] of [['claude', 11], ['claude, codex', 11]]) {
    const text = `mode: quick\nanswers:\n  user.agents: [${agents}]\n  idea.text: A tiny tool.\n  arch.language: typescript\n  arch.runs-on: local\n`;
    const r = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), text), '--yes', '--skip-verify']);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /modules: core\n/);
    const files = Object.keys(readTree(r.cwd)).filter((p) => !p.startsWith('.yaw/base/'));
    assert.equal(files.length, count + 1, files.join(', ')); // the required idea also creates README.md
  }
});

test('answers without a proposal: the stack picks the profile and it is written back', async () => {
  const text = 'mode: quick\nanswers:\n  user.agents: [codex]\n  idea.text: A tiny tool.\n  arch.language: python\n  arch.runs-on: local\n';
  const r = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), text), '--yes', '--skip-verify']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /profile: python-cli \(python on local\)/);
  assert.match(r.out, /user\.language +de +\(documented default\)/, 'questions missing from the file are listed as default');
  const doc = parseDocument(readFileSync(join(r.cwd, '.yaw/answers.yaml'), 'utf8')).value;
  assert.deepEqual(doc.proposal.profiles, ['python-cli']);
  assert.match(readFileSync(join(r.cwd, 'AGENTS.md'), 'utf8'), /Chat in "de"/);
  assert.deepEqual(readManifest(r.cwd).agents, ['codex']);
});

test('answers without a proposal and without a stack are refused before anything is written', async () => {
  const text = 'mode: quick\nanswers:\n  user.agents: [claude]\n';
  const r = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), text), '--yes', '--skip-verify']);
  assert.equal(r.code, 1);
  assert.match(r.err, /choose a language and where it runs/);
  assert.deepEqual(readdirSync(r.cwd), []);
});

test('an unknown profile and a profile listed twice are refused', async () => {
  const body = (profiles) => `mode: quick\nanswers:\n  user.agents: [claude]\nproposal:\n  status: confirmed\n  summary: x\n  profiles: [${profiles}]\n  modules: [core]\n`;
  const unknown = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), body('ruby-cli')), '--yes', '--skip-verify']);
  assert.match(unknown.err, /profile "ruby-cli" does not exist in this kit \(available: android-kotlin, browser-extension, cloudflare-workers, go-basic, /);
  const several = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), body('node-cli, node-cli')), '--yes', '--skip-verify']);
  assert.match(several.err, /proposal\/profiles\/1 duplicates item 0/);
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

test('init ends with next steps: agent start, Codex hook trust, data locations, tools (#167, #176)', async () => {
  const text = readFileSync(EXAMPLE, 'utf8').replace('user.agents: [claude]', 'user.agents: [codex]').replace('modules: [core]', 'modules: [core, standards, security, tasks, sessions, decisions]');
  const r = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), text), '--yes', '--skip-verify']);
  assert.equal(r.code, 0, r.err);
  const steps = r.out.slice(r.out.indexOf('\nNext steps\n'));
  assert.ok(r.out.endsWith(steps), 'the block comes last');
  assert.match(steps, /Start Codex in this folder; it reads AGENTS\.md\./);
  assert.match(steps, /Codex: run \/hooks once and trust the YAW hooks/);
  assert.match(steps, /Tasks: TASKS\.md \(just task list/);
  assert.match(steps, /Sessions: yaw sessions list; the registry is ~\/\.yaw\/yaw\.db/);
  assert.match(steps, /Decisions: \.decisions\//);
  assert.match(steps, /Dashboard: yaw web/);
  assert.match(steps, /Tools this setup needs: node>=22\.13, just/);
  const claude = await yaw(['init', '--answers', EXAMPLE, '--yes', '--skip-verify']);
  assert.match(claude.out, /Start Claude Code in this folder; it reads AGENTS\.md \(through CLAUDE\.md\)\./);
  assert.doesNotMatch(claude.out, /run \/hooks/);
});

test('init refuses the home folder unless forced and asks before writing into a folder of projects (#168)', async () => {
  const home = tmp('yaw-home-');
  const env = { PATH: NODE_ONLY, HOME: home };
  const refused = await yaw(['init', '--answers', EXAMPLE, '--yes', '--skip-verify'], { cwd: home, env });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /refusing to set up YAW in your home folder .*or pass --force/);
  assert.deepEqual(readdirSync(home), []);
  const forced = await yaw(['init', '--answers', EXAMPLE, '--yes', '--skip-verify', '--force'], { cwd: home, env });
  assert.equal(forced.code, 0, forced.err);
  assert.match(forced.err, /warning: setting up YAW in your home folder/);

  const parent = tmp('yaw-parent-');
  for (const p of ['app-a', 'app-b']) mkdirSync(join(parent, p, '.git'), { recursive: true });
  writeFileSync(join(parent, 'notes.txt'), 'x');
  const prompter = scripted(['n']);
  const declined = await yaw(['init'], { cwd: parent, prompter });
  assert.equal(declined.code, 1);
  assert.match(declined.out, /not empty \(3 entries, 2 of them Git repositories\)[\s\S]*folder of projects[\s\S]*cancelled; nothing was written/);
  assert.deepEqual(readdirSync(parent).sort(), ['app-a', 'app-b', 'notes.txt']);
  const noTty = await yaw(['init', '--web'], { cwd: parent });
  assert.equal(noTty.code, 1);
  assert.match(noTty.err, /run again with --force/);
  const yes = await yaw(['init', '--answers', EXAMPLE, '--yes', '--skip-verify'], { cwd: parent });
  assert.equal(yes.code, 0, yes.err);
  assert.match(yes.err, /warning: This folder is not empty/);

  const repo = tmp('yaw-repo-');
  mkdirSync(join(repo, '.git'));
  writeFileSync(join(repo, 'index.js'), '');
  const quiet = await yaw(['init', '--answers', EXAMPLE, '--yes', '--skip-verify'], { cwd: repo });
  assert.equal(quiet.code, 0, quiet.err);
  assert.doesNotMatch(quiet.err, /not empty/);
});

test('init puts the idea into README.md: a new file, or a section appended once to an existing one (#171)', async () => {
  const fresh = await yaw(['init', '--answers', EXAMPLE, '--yes', '--skip-verify']);
  assert.equal(fresh.code, 0, fresh.err);
  const readme = readFileSync(join(fresh.cwd, 'README.md'), 'utf8');
  assert.match(readme, /^# Project idea\n\nA small command-line tool that renames photos by their EXIF date\.\n/);
  assert.match(fresh.out, /added: README\.md/);
  assert.match(fresh.out, /Your idea: README\.md\./);
  assert.deepEqual(readManifest(fresh.cwd).files.find((f) => f.path === 'README.md')?.managed, false);

  const dir = tmp('yaw-proj-');
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, 'README.md'), '# Mine\n\nDo not touch.');
  const kept = await yaw(['init', '--answers', EXAMPLE, '--yes', '--skip-verify'], { cwd: dir });
  assert.equal(kept.code, 0, kept.err);
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), '# Mine\n\nDo not touch.\n\n<!-- yaw:idea -->\n## Idea\n\nA small command-line tool that renames photos by their EXIF date.\n<!-- /yaw:idea -->\n');
  assert.match(kept.out, /added your idea as a section to: README\.md/);
  assert.equal(readManifest(dir).files.find((f) => f.path === 'README.md'), undefined, 'the user file stays unrecorded');
});

test('interview: "web" at a question continues in the browser form with the answers so far; nothing is written (#162)', async () => {
  const dir = tmp('yaw-proj-');
  const stdout = capture();
  const asked = [];
  const prompter = scripted(['basic', 'codex', 'web']);
  const ask = prompter.ask;
  prompter.ask = async (q) => { asked.push(q); return ask(q); };
  let url;
  const running = main(['init', '--skip-verify'], {
    cwd: dir, env: { PATH: NODE_ONLY, HOME: tmp('yaw-home-') }, kitRoot: KIT_ROOT, stdout, stderr: capture(), prompter,
    openBrowser: async (u) => { url = u; return true; },
  });
  for (let i = 0; i < 100 && !url; i++) await new Promise((r) => setTimeout(r, 20));
  const cookie = (await fetch(url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  const boot = await (await fetch(new URL('/api/bootstrap', url), { headers: { cookie } })).json();
  process.emit('SIGINT');
  await running;
  assert.match(asked[0], /Setup depth \[quick\] > $/);
  assert.match(asked[1], /\] > $/);
  assert.match(prompter.shown.join(''), / {2}\(w switch to browser\)\n/);
  assert.match(prompter.shown.join(''), / {6}\(\? help, skip, w switch to browser\)\n/);
  assert.deepEqual(boot.handoff.answers['user.agents'], ['codex']);
  assert.equal(boot.handoff.answers['user.expertise'], undefined, 'handoff occurs before that question is answered');
  assert.ok(!Object.hasOwn(boot.handoff.answers, 'arch.language'));
  assert.match(stdout.text(), /Continuing in the browser with your answers so far; nothing was written\./);
  assert.deepEqual(readdirSync(dir), []);
});

test('setup depth "w" opens the form at once, with an empty hand-off (#162)', async () => {
  const dir = tmp('yaw-proj-');
  let url;
  const running = main(['init'], {
    cwd: dir, env: { PATH: NODE_ONLY, HOME: tmp('yaw-home-') }, kitRoot: KIT_ROOT, stdout: capture(), stderr: capture(), prompter: scripted(['W']),
    openBrowser: async (u) => { url = u; return true; },
  });
  for (let i = 0; i < 100 && !url; i++) await new Promise((r) => setTimeout(r, 20));
  const cookie = (await fetch(url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  const boot = await (await fetch(new URL('/api/bootstrap', url), { headers: { cookie } })).json();
  process.emit('SIGINT');
  await running;
  assert.deepEqual(boot.handoff, { mode: 'quick', answers: {} });
  assert.deepEqual(readdirSync(dir), []);
});

test('interview: declining the kickoff guidance prints no prompt', async () => {
  const dir = tmp('yaw-proj-');
  const r = await yaw(['init', '--skip-verify'], { cwd: dir, prompter: scripted([...INTERVIEW, 'y', '', '', 'n']) });
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(r.out, /----- prompt -----/);
});
