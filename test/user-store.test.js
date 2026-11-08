// User profile and saved setups (Y-7.2, ADR-0043): opt-in prompt, ~/.yaw layout and modes, yaw presets, no secrets.
// HOME is always a temp dir; the real ~/.yaw is never touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { main } from '../core/cli/main.js';
import { parseDocument } from '../core/lib/yaml.js';
import { saveSetup, secretFindings, writePresetAnswers } from '../core/lib/user-store.js';
import { schemas } from '../core/render/kit.js';
import { KIT_ROOT, capture, scripted, tmp } from './helpers/fixtures.js';

const NODE_ONLY = [dirname(process.execPath), '/usr/bin', '/bin'].join(':');
const INTERVIEW = ['', '', 'Rename photos by EXIF date.', 'typescript', 'local', 'n'];
const CANARY = 'ghp_CANARY0123456789abcdefghijklmnopqrst';
const mode = (p) => statSync(p).mode & 0o777;

async function yaw(args, { home, cwd = tmp('yaw-proj-'), prompter } = {}) {
  const stdout = capture();
  const stderr = capture();
  const p = prompter ?? { ...scripted(), interactive: false };
  const code = await main(args, { stdout, stderr, cwd, env: { PATH: NODE_ONLY, HOME: home }, kitRoot: KIT_ROOT, prompter: p });
  return { code, out: stdout.text(), err: stderr.text(), cwd };
}

function tree(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    return e.isDirectory() ? [rel, ...tree(root, rel)] : [rel];
  });
}

test('opt-in: the default is no; declining and non-interactive runs write nothing to ~/.yaw', async () => {
  const home = tmp('yaw-home-');
  const declinedP = scripted([...INTERVIEW, 'y', '', '', '']);
  const declined = await yaw(['init', '--skip-verify'], { home, prompter: declinedP });
  assert.equal(declined.code, 0, declined.err);
  assert.match(declinedP.asked.join('\n'), /Save this setup as a preset in .*\.yaw\/presets\/ and add a line \(project path, date, kit version\) to .*history\.jsonl\?/);
  assert.match(declined.out, /personal defaults are managed separately/);
  assert.match(declined.out, /Preset not saved; no preset or history entry was written/);
  assert.deepEqual(readdirSync(home), []);
  // --answers (no interview) never asks and never writes
  const answers = join(KIT_ROOT, 'examples', 'node-cli', 'answers.yaml');
  const file = await yaw(['init', '--answers', answers, '--yes', '--skip-verify'], { home });
  assert.equal(file.code, 0, file.err);
  assert.deepEqual(readdirSync(home), []);
});

test('presets remain opt-in; personal defaults are saved separately and unchanged by Quick', async () => {
  const home = tmp('yaw-home-');
  saveSetup({ env: { HOME: home }, kitRoot: KIT_ROOT, answers: { 'user.agents': ['claude'], 'user.language': 'de', 'user.autonomy': 'ask-risky' }, mode: 'quick', projectRoot: tmp(), kit: '0.1.0', preset: false, profile: true });
  const r = await yaw(['init', '--skip-verify'], { home, prompter: scripted([...INTERVIEW, 'y', 'y', '']) });
  assert.equal(r.code, 0, r.err);
  const dir = join(home, '.yaw');
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(join(dir, 'presets')), 0o700);
  for (const f of ['user-profile.yaml', 'history.jsonl']) assert.equal(mode(join(dir, f)), 0o600, f);
  const presets = readdirSync(join(dir, 'presets'));
  assert.equal(presets.length, 1);
  assert.match(presets[0], /^\d{4}-\d{2}-\d{2}-yaw-proj-.*\.yaml$/);
  assert.equal(mode(join(dir, 'presets', presets[0])), 0o600);

  const profile = parseDocument(readFileSync(join(dir, 'user-profile.yaml'), 'utf8')).value;
  assert.deepEqual(profile.answers['user.agents'], ['claude']);
  assert.equal(profile.answers['user.language'], 'de');
  assert.equal(profile.answers['user.autonomy'], 'ask-risky');
  assert.equal(Object.hasOwn(profile.answers, 'idea.text'), false, 'the profile holds user.* answers only');

  const preset = parseDocument(readFileSync(join(dir, 'presets', presets[0]), 'utf8')).value;
  assert.equal(`${preset.name}.yaml`, presets[0]);
  assert.equal(preset.mode, 'quick');
  assert.equal(preset.answers['idea.text'], 'Rename photos by EXIF date.');
  assert.equal(preset.source, r.cwd);

  const lines = readFileSync(join(dir, 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(lines[0]), ['path', 'date', 'kit', 'preset']);
  assert.equal(lines[0].path, r.cwd);
  assert.equal(lines[0].preset, preset.name);

  // no standing yes: the second setup is asked again, a "no" to both writes nothing new
  const againP = scripted([...INTERVIEW, 'y', '', '', '']);
  const again = await yaw(['init', '--skip-verify'], { home, prompter: againP });
  assert.equal(again.code, 0, again.err);
  assert.match(againP.asked.join('\n'), /Save this setup as a preset/);
  assert.equal(readFileSync(join(dir, 'history.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.equal(readdirSync(join(dir, 'presets')).length, 1);

  // preset yes, profile no: the profile file stays as it was
  const before = readFileSync(join(dir, 'user-profile.yaml'), 'utf8');
  const third = await yaw(['init', '--skip-verify'], { home, prompter: scripted([...INTERVIEW, 'y', 'y', '', '']) });
  assert.equal(third.code, 0, third.err);
  assert.equal(readFileSync(join(dir, 'history.jsonl'), 'utf8').trim().split('\n').length, 2);
  assert.equal(readdirSync(join(dir, 'presets')).length, 2);
  assert.equal(readFileSync(join(dir, 'user-profile.yaml'), 'utf8'), before);
  assert.equal(mode(join(dir, 'history.jsonl')), 0o600);
});

test('broken personal defaults are ignored and preserved during Quick setup', async () => {
  for (const text of ['answers: [unclosed\n  : :\n', 'answers:\n  user.nonsense: 1\n']) {
    const home = tmp('yaw-home-');
    mkdirSync(join(home, '.yaw'), { recursive: true });
    writeFileSync(join(home, '.yaw/user-profile.yaml'), text);
    const r = await yaw(['init', '--skip-verify'], { home, prompter: scripted([...INTERVIEW, 'y', '', '']) });
    assert.equal(r.code, 0, r.err);
    assert.match(r.err, /unreadable or invalid/);
    assert.equal(readFileSync(join(home, '.yaw/user-profile.yaml'), 'utf8'), text);
    assert.deepEqual(readdirSync(join(home, '.yaw')), ['user-profile.yaml']);
  }
});

test('user-store refuses symlinked profile, preset, and history targets without writing through them', () => {
  const date = new Date('2026-10-20T10:00:00Z');
  const cases = [
    { name: 'profile', path: '.yaw/user-profile.yaml', options: { preset: false } },
    { name: 'preset', path: '.yaw/presets/2026-10-20-app.yaml', options: { profile: false } },
    { name: 'history', path: '.yaw/history.jsonl', options: { profile: false } },
  ];
  for (const entry of cases) {
    const home = tmp('yaw-home-');
    const dir = join(home, '.yaw');
    const target = join(home, 'outside.txt');
    mkdirSync(join(dir, 'presets'), { recursive: true });
    writeFileSync(target, 'untouched\n');
    symlinkSync(target, join(home, entry.path));
    assert.throws(() => saveSetup({
      env: { HOME: home }, kitRoot: KIT_ROOT, answers: { 'user.agents': ['claude'], 'idea.team': 'solo' },
      mode: 'quick', projectRoot: '/work/app', kit: '0.0.0', now: date, ...entry.options,
    }), /symbolic link|cannot be read/i, entry.name);
    assert.equal(readFileSync(target, 'utf8'), 'untouched\n', entry.name);
    assert.deepEqual(readdirSync(join(dir, 'presets')), entry.name === 'preset' ? ['2026-10-20-app.yaml'] : [], entry.name);
  }
});

test('user-store refuses symlinked ~/.yaw directories', () => {
  const home = tmp('yaw-home-');
  const outside = tmp('yaw-outside-');
  const target = join(outside, 'user-profile.yaml');
  writeFileSync(target, 'untouched\n');
  symlinkSync(outside, join(home, '.yaw'));
  assert.throws(() => saveSetup({
    env: { HOME: home }, kitRoot: KIT_ROOT, answers: { 'user.agents': ['claude'] },
    mode: 'quick', projectRoot: '/work/app', kit: '0.0.0', profile: true, preset: false,
  }), /real directory|symbolic link/i);
  assert.equal(readFileSync(target, 'utf8'), 'untouched\n');
  assert.deepEqual(readdirSync(outside), ['user-profile.yaml']);
});

test('yaw presets list / show / delete', async () => {
  const home = tmp('yaw-home-');
  const empty = await yaw(['presets', 'list'], { home });
  assert.equal(empty.code, 0);
  assert.match(empty.out, /no saved setups/);
  assert.deepEqual(readdirSync(home), [], 'listing creates nothing');

  const saved = saveSetup({ env: { HOME: home }, kitRoot: KIT_ROOT, answers: { 'user.agents': ['claude'], 'idea.team': 'solo' }, mode: 'quick', projectRoot: '/work/my-app', kit: '0.0.0', now: new Date('2026-10-20T10:00:00Z') });
  assert.equal(saved.preset, '2026-10-20-my-app');
  const list = await yaw(['presets', 'list'], { home });
  assert.match(list.out, /^2026-10-20-my-app +quick {2}2026-10-20 {2}Setup of my-app\.$/m);
  const show = await yaw(['presets', 'show', '2026-10-20-my-app'], { home });
  assert.equal(show.out, readFileSync(join(home, '.yaw/presets/2026-10-20-my-app.yaml'), 'utf8'));
  assert.match(show.out, /idea\.team: solo/);

  // path traversal and unknown names are refused
  assert.equal((await yaw(['presets', 'show', '../user-profile'], { home })).code, 1);
  assert.match((await yaw(['presets', 'show', 'nope'], { home })).err, /no preset "nope"/);

  // delete: confirmation or --yes; non-interactive without --yes refuses
  const file = join(home, '.yaw/presets/2026-10-20-my-app.yaml');
  const refused = await yaw(['presets', 'delete', '2026-10-20-my-app'], { home });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /--yes/);
  assert.ok(existsSync(file));
  const no = await yaw(['presets', 'delete', '2026-10-20-my-app'], { home, prompter: scripted(['']) });
  assert.equal(no.code, 1);
  assert.ok(existsSync(file), 'the default answer is no');
  const yes = await yaw(['presets', 'delete', '2026-10-20-my-app'], { home, prompter: scripted(['y']) });
  assert.equal(yes.code, 0);
  assert.equal(existsSync(file), false);
  saveSetup({ env: { HOME: home }, kitRoot: KIT_ROOT, answers: { 'idea.team': 'solo' }, mode: 'quick', projectRoot: '/work/other', kit: '0.0.0', now: new Date('2026-10-21T10:00:00Z') });
  assert.equal((await yaw(['presets', 'delete', '2026-10-21-other', '--yes'], { home })).code, 0);
});

test('secrets: a secret-type key or a secret-looking value refuses the save; the canary appears nowhere', async () => {
  const env = { HOME: tmp('yaw-home-') };
  const base = { projectRoot: '/work/app', kit: '0.0.0', mode: 'quick', env, kitRoot: KIT_ROOT };
  const A = 'idea.text';
  const assign = (text) => [{ [A]: text }, A, 'assignment'];
  const bad = [
    [{ 'idea.text': `use ${CANARY} for deploys` }, 'idea.text', 'token-prefix'],
    [{ 'idea.text': 'MY_KEY_ghp_CANARY0123456789abcdefghijklmnopqrst' }, 'idea.text', 'token-prefix'],
    [{ 'idea.text': '1ghp_CANARY0123456789abcdefghijklmnopqrst' }, 'idea.text', 'token-prefix'],
    [{ 'idea.text': 'hf_abcdefghijklmnopqrstuvwxyz' }, 'idea.text', 'token-prefix'],
    [{ 'idea.text': 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz' }, 'idea.text', 'token-prefix'],
    [{ 'idea.text': 'sk-proj-abcdefghijklmnop1234' }, 'idea.text', 'token-prefix'],
    [{ 'idea.text': 'Authorization: Bearer abcdef.123456' }, 'idea.text', 'bearer'],
    [{ 'idea.text': 'sk_live_abcdefghijklmnop1234' }, 'idea.text', 'token-prefix'],
    [{ 'idea.text': 'rk_live_abcdefghijklmnop1234' }, 'idea.text', 'token-prefix'],
    [{ 'idea.text': `npm_${'a1'.repeat(18)}` }, 'idea.text', 'token-prefix'],
    [{ 'idea.text': `hf_${'a1'.repeat(18)}` }, 'idea.text', 'token-prefix'],
    [{ 'idea.text': 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop' }, 'idea.text', 'jwt'],
    [{ 'idea.text': '-----BEGIN OPENSSH PRIVATE KEY-----' }, 'idea.text', 'private-key-block'],
    [{ 'idea.text': '-----BEGIN PGP PRIVATE KEY BLOCK-----' }, 'idea.text', 'private-key-block'],
    [{ 'idea.text': 'Authorization: Bearer abcdef0123456789xyz' }, 'idea.text', 'bearer'],
    [{ 'arch.db': 'postgres://admin:s3cretpw@db.example.com/app' }, 'arch.db', 'url-credentials'],
    [{ 'arch.db': 'redis://:pw123@host:6379' }, 'arch.db', 'url-credentials'],
    [{ 'arch.db': 'postgres://u:pa/ss@h/app' }, 'arch.db', 'url-credentials'],
    assign('API_KEY=hunter2hunter2'),
    assign('SECRET_KEY=hunter2hunter2'),
    assign('AWS_SECRET_ACCESS_KEY=hunter2hunter2'),
    assign('private_key=hunter2hunter2'),
    assign('DB_PASS=hunter2hunter2'),
    assign('pwd=hunter2hunter2'),
    assign('passphrase=hunter2hunter2'),
    assign('PassWord=hunter2hunter2'),
    assign('"api_key": "hunter2hunter2"'),
    assign('"password": "hunter2hunter2"'),
    [{ 'arch.notes': ['fine', '.env'] }, 'arch.notes', 'dotenv'],
    [{ 'vendors.api-token': 'x' }, 'vendors.api-token', 'secret-type key'],
  ];
  for (const [answers, key, rule] of bad) {
    const f = secretFindings({ answers, kitRoot: KIT_ROOT });
    assert.deepEqual(f, [{ key, rule }], JSON.stringify(answers));
    const r = saveSetup({ ...base, answers: { 'user.language': 'en', ...answers } });
    assert.equal(r.saved, false);
  }
  assert.equal(existsSync(join(env.HOME, '.yaw')), false, 'nothing is written when a save is refused');
  for (const ok of ['A small tool for photos.', 'local', 'bypass: enabled by default', 'tokens: 12', 'see http://localhost:8080/path?mail=a@b.example', 'the task-runner skips it', 'password reset flow for users', 'Bearer of good news', 'sk-learn-compatible-pipelines']) {
    assert.deepEqual(secretFindings({ answers: { 'idea.text': ok }, kitRoot: KIT_ROOT }), [], ok);
  }

  // end to end: the canary typed into the interview is not saved, not printed
  const home = tmp('yaw-home-');
  const interview = [...INTERVIEW];
  interview[2] = `Deploy with ${CANARY}`;
  const prompter = scripted([...interview, 'y', 'y', '']);
  const r = await yaw(['init', '--skip-verify'], { home, prompter });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /not saved: idea\.text \(token-prefix\) looks like a secret/);
  const everything = [r.out, r.err, ...prompter.shown, ...(existsSync(join(home, '.yaw')) ? tree(home).map((f) => (statSync(join(home, f)).isFile() ? readFileSync(join(home, f), 'utf8') : '')) : [])].join('\n');
  assert.doesNotMatch(everything, new RegExp(CANARY.slice(0, 20)));
  assert.match(r.out, /The value is already in this project: \.yaw\/answers\.yaml, AGENTS\.md and \.yaw\/base\/AGENTS\.md/);
  for (const f of ['.yaw/answers.yaml', 'AGENTS.md', '.yaw/base/AGENTS.md']) assert.match(readFileSync(join(r.cwd, f), 'utf8'), new RegExp(CANARY.slice(0, 20)), f);
  assert.match(r.out, /idea\.text +\(hidden: looks like a secret\)/);
  assert.equal(existsSync(join(home, '.yaw')), false);
});

test('secret rules: no ReDoS on 100k-character values, and flags cannot be duplicated', () => {
  const inputs = ["://".repeat(33333), 'token_'.repeat(16666), 'sk-'.repeat(33333), 'Bearer '.repeat(14285), 'token='.repeat(16666), ':'.repeat(100000), 'a'.repeat(100000)];
  for (const text of inputs) {
    const t = performance.now();
    secretFindings({ answers: { 'idea.text': text }, kitRoot: KIT_ROOT });
    assert.ok(performance.now() - t < 500, `${text.slice(0, 12)}: ${Math.round(performance.now() - t)} ms`);
  }
  const rule = (flags) => ({ guards: [{ id: 'a', pattern: 'x', flags, reason: 'r' }] });
  assert.deepEqual(schemas().validate('guards.schema.json', rule('i')), []);
  assert.deepEqual(schemas().validate('guards.schema.json', rule('im')), []);
  assert.notDeepEqual(schemas().validate('guards.schema.json', rule('ii')), []);
});

test('preset listings display the All label for stored pro depth', async () => {
  const home = tmp('yaw-home-');
  saveSetup({ env: { HOME: home }, kitRoot: KIT_ROOT, answers: { 'idea.team': 'solo' }, mode: 'pro', projectRoot: '/work/all-tools', kit: '0.0.0', now: new Date('2026-10-29T10:00:00Z') });
  const list = await yaw(['presets', 'list'], { home });
  assert.equal(list.code, 0, list.err);
  assert.match(list.out, /^2026-10-29-all-tools +all {2}/m);
});

// Replace a node:fs function for the user-store module (live ESM bindings) while `body` runs.
function patched(name, wrap, body) {
  const original = fs[name];
  fs[name] = wrap(original);
  syncBuiltinESMExports();
  try { return body(); } finally { fs[name] = original; syncBuiltinESMExports(); }
}

test('user-store keeps existing data when a write fails and leaves no temporary files', () => {
  const home = tmp('yaw-home-');
  const env = { HOME: home };
  const save = (now) => saveSetup({ env, kitRoot: KIT_ROOT, answers: { 'user.agents': ['claude'], 'idea.team': 'solo' }, mode: 'quick', projectRoot: '/work/app', kit: '0.0.0', now });
  save(new Date('2026-10-20T10:00:00Z'));
  const profile = join(home, '.yaw/user-profile.yaml');
  const preset = join(home, '.yaw/presets/2026-10-20-app.yaml');
  const before = [readFileSync(profile, 'utf8'), readFileSync(preset, 'utf8')];
  const failing = (original) => (...args) => { if (typeof args[1] === 'string' && args[1].length > 10) throw Object.assign(new Error('no space left'), { code: 'ENOSPC' }); return original(...args); };
  patched('writeFileSync', failing, () => {
    assert.throws(() => saveSetup({ env, kitRoot: KIT_ROOT, answers: { 'user.agents': ['codex'] }, mode: 'quick', projectRoot: '/work/app', kit: '0.0.0', preset: false }), /no space/);
    assert.throws(() => writePresetAnswers(env, '2026-10-20-app', { 'idea.team': 'team' }), /no space/);
  });
  assert.deepEqual([readFileSync(profile, 'utf8'), readFileSync(preset, 'utf8')], before);
  assert.deepEqual(readdirSync(join(home, '.yaw')).sort(), ['history.jsonl', 'presets', 'user-profile.yaml']);
  assert.deepEqual(readdirSync(join(home, '.yaw/presets')), ['2026-10-20-app.yaml']);
});

test('user-store publishes replacements as new private files, never through hard links', () => {
  const home = tmp('yaw-home-');
  const env = { HOME: home };
  saveSetup({ env, kitRoot: KIT_ROOT, answers: { 'user.agents': ['claude'] }, mode: 'quick', projectRoot: '/work/app', kit: '0.0.0', preset: false });
  const profile = join(home, '.yaw/user-profile.yaml');
  const link = join(home, 'linked.yaml');
  fs.linkSync(profile, link);
  const old = readFileSync(link, 'utf8');
  saveSetup({ env, kitRoot: KIT_ROOT, answers: { 'user.agents': ['codex'] }, mode: 'quick', projectRoot: '/work/app', kit: '0.0.0', preset: false });
  assert.equal(readFileSync(link, 'utf8'), old);
  assert.match(readFileSync(profile, 'utf8'), /codex/);
  assert.equal(mode(profile), 0o600);
});

test('concurrent preset creation never overwrites a preset another save just published', () => {
  const home = tmp('yaw-home-');
  const env = { HOME: home };
  const other = join(home, '.yaw/presets/2026-10-20-app.yaml');
  mkdirSync(join(home, '.yaw/presets'), { recursive: true });
  let raced = false;
  // Another save publishes the same name right after this one found it free.
  const race = (original) => (path, ...rest) => {
    try { return original(path, ...rest); } catch (e) {
      if (!raced && e.code === 'ENOENT' && path === other) { raced = true; writeFileSync(other, 'name: other\n'); }
      throw e;
    }
  };
  const result = patched('lstatSync', race, () => saveSetup({
    env, kitRoot: KIT_ROOT, answers: { 'user.agents': ['claude'] }, mode: 'quick', projectRoot: '/work/app', kit: '0.0.0',
    now: new Date('2026-10-20T10:00:00Z'), profile: false,
  }));
  assert.ok(raced);
  assert.equal(result.preset, '2026-10-20-app-2');
  assert.equal(readFileSync(other, 'utf8'), 'name: other\n');
  assert.deepEqual(readdirSync(join(home, '.yaw/presets')).sort(), ['2026-10-20-app-2.yaml', '2026-10-20-app.yaml']);
});
