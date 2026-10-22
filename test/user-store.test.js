// User profile and saved setups (Y-7.2, ADR-0043): opt-in prompt, ~/.yaw layout and modes, yaw presets, no secrets.
// HOME is always a temp dir; the real ~/.yaw is never touched.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { main } from '../core/cli/main.js';
import { parseDocument } from '../core/lib/yaml.js';
import { saveSetup, secretFindings } from '../core/lib/user-store.js';
import { KIT_ROOT, capture, scripted, tmp } from './helpers/fixtures.js';

const NODE_ONLY = [dirname(process.execPath), '/usr/bin', '/bin'].join(':');
const INTERVIEW = ['', '', '', 'en', 'skip', 'Rename photos by EXIF date.', '', 'javascript', 'local', '', ''];
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
  const declined = await yaw(['init', '--skip-verify'], { home, prompter: scripted([...INTERVIEW, '', 'y', '']) });
  assert.equal(declined.code, 0, declined.err);
  assert.match(declined.out, /May the kit store your preferences and this setup in .*\.yaw\//);
  assert.match(declined.out, /not saved; nothing was written to the user folder/);
  assert.deepEqual(readdirSync(home), []);
  // --answers (no interview) never asks and never writes
  const answers = join(KIT_ROOT, 'examples', 'node-cli', 'answers.yaml');
  const file = await yaw(['init', '--answers', answers, '--yes', '--skip-verify'], { home });
  assert.equal(file.code, 0, file.err);
  assert.deepEqual(readdirSync(home), []);
});

test('opt-in yes: profile, preset and history are written with restrictive modes; later runs do not ask again', async () => {
  const home = tmp('yaw-home-');
  const r = await yaw(['init', '--skip-verify'], { home, prompter: scripted([...INTERVIEW, '', 'y', 'y']) });
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
  assert.equal(profile.answers['user.language'], 'en');
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

  // standing yes: the second run is not asked and appends
  const p2 = scripted([...INTERVIEW, '', 'y']);
  const again = await yaw(['init', '--skip-verify'], { home, prompter: p2 });
  assert.equal(again.code, 0, again.err);
  assert.doesNotMatch(again.out, /May the kit store/);
  assert.equal(readFileSync(join(dir, 'history.jsonl'), 'utf8').trim().split('\n').length, 2);
  assert.equal(readdirSync(join(dir, 'presets')).length, 2);
  assert.equal(mode(join(dir, 'history.jsonl')), 0o600);
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
  const bad = [
    [{ 'idea.text': `use ${CANARY} for deploys` }, 'idea.text', 'token-prefix'],
    [{ 'idea.text': 'API_KEY=hunter2hunter2' }, 'idea.text', 'assignment'],
    [{ 'idea.text': '-----BEGIN OPENSSH PRIVATE KEY-----' }, 'idea.text', 'private-key-block'],
    [{ 'arch.db': 'postgres://admin:s3cretpw@db.example.com/app' }, 'arch.db', 'url-credentials'],
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
  assert.deepEqual(secretFindings({ answers: { 'idea.text': 'A small tool for photos.', 'arch.runs-on': 'local' }, kitRoot: KIT_ROOT }), []);

  // end to end: the canary typed into the interview is not saved, not printed
  const home = tmp('yaw-home-');
  const interview = [...INTERVIEW];
  interview[5] = `Deploy with ${CANARY}`;
  const prompter = scripted([...interview, '', 'y', 'y']);
  const r = await yaw(['init', '--skip-verify'], { home, prompter });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /not saved: idea\.text \(token-prefix\) looks like a secret/);
  const everything = [r.out, r.err, ...prompter.shown, ...(existsSync(join(home, '.yaw')) ? tree(home).map((f) => (statSync(join(home, f)).isFile() ? readFileSync(join(home, f), 'utf8') : '')) : [])].join('\n');
  assert.doesNotMatch(everything, new RegExp(CANARY.slice(0, 20)));
  assert.match(r.out, /idea\.text +\(hidden: looks like a secret\)/);
  assert.equal(existsSync(join(home, '.yaw')), false);
});
