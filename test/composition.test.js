// Profile composition (Y-6.8, ADR-0041): static-site + cloudflare-workers in one project. Namespaced `just` modules,
// uniform verbs at the top level that call every profile, guards of both profiles, removal of one profile.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { composedVerbs } from '../core/render/kit.js';
import { commandRule, loadRules, secretRule } from '../modules/security/lib/guards.js';
import guardDestructive from '../modules/security/hooks/guard-destructive.js';
import { KIT_ROOT, cleanEnv, hasTool, run, tmp } from './helpers/fixtures.js';

const YAW = join(KIT_ROOT, 'bin', 'yaw');
const ANSWERS = join(KIT_ROOT, 'examples', 'composed', 'answers.yaml');
const PROFILES = ['static-site', 'cloudflare-workers'];
const skipJust = !hasTool('just') && 'just is not installed';
const skipNet = skipJust || (!hasTool('npm') && 'npm is not installed') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (npm install needs the network)');
const read = (cwd, rel) => readFileSync(join(cwd, rel), 'utf8');

function initComposed(extra = []) {
  const cwd = tmp('yaw-compose-');
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' });
  const r = run(process.execPath, [YAW, 'init', '--answers', ANSWERS, '--yes', ...extra], { cwd, env });
  return { cwd, env, r };
}

test('composedVerbs: nothing for one profile; every verb calls every profile, check ends with sync-check', () => {
  assert.equal(composedVerbs(['static-site']), '');
  const text = composedVerbs(PROFILES);
  assert.match(text, /^check: static-site::check cloudflare-workers::check sync-check$/m);
  assert.match(text, /^deploy env='': \(static-site::deploy env\) \(cloudflare-workers::deploy env\)$/m);
  assert.match(text, /^lint: static-site::lint cloudflare-workers::lint$/m);
});

test('init with two profiles: modules in their own folders, scaffold per profile, flat import is gone', () => {
  const { cwd, r } = initComposed(['--skip-verify']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const justfile = read(cwd, 'justfile');
  for (const p of PROFILES) {
    assert.match(justfile, new RegExp(`^mod ${p} 'just/${p}.just'$`, 'm'));
    assert.match(read(cwd, `just/${p}.just`), new RegExp(`^set working-directory := '../${p}'$`, 'm'));
    assert.ok(existsSync(join(cwd, p, 'package.json')), `${p}/package.json`);
  }
  assert.doesNotMatch(justfile, /^import 'just\/(static-site|cloudflare-workers)\.just'/m);
  assert.equal(existsSync(join(cwd, 'package.json')), false, 'no scaffold at the root');
  assert.doesNotMatch(read(cwd, 'just/static-site.just'), /^check:.*sync-check/m);
  const manifest = JSON.parse(read(cwd, '.yaw/manifest.json'));
  assert.deepEqual(manifest.profiles, PROFILES);
  for (const p of PROFILES) assert.equal(manifest.files.find((f) => f.path === `just/${p}.just`).module, 'core');
});

test('top-level verbs call both profiles, namespaced verbs stay; deploy keeps the refusal of cloudflare-workers', { skip: skipJust }, () => {
  const { cwd, env } = initComposed(['--skip-verify']);
  const out = run('just', ['--list'], { cwd, env });
  assert.equal(out.status, 0, out.stderr);
  for (const p of PROFILES) assert.match(out.stdout, new RegExp(`^\\s+${p} \\.\\.\\.`, 'm'));
  for (const verb of ['db-migrate', 'backup', 'screenshot']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.equal((r.stdout.match(new RegExp(`^${verb}: not applicable`, 'gm')) ?? []).length, 2, `${verb} ran in both profiles`);
  }
  const one = run('just', ['static-site::build'], { cwd, env });
  assert.equal(one.status, 0);
  assert.equal((one.stdout.match(/not applicable for/g) ?? []).length, 1, 'a namespaced verb runs one profile');
  const dev = run('just', ['dev'], { cwd, env });
  assert.match(dev.stdout, /just static-site::dev, just cloudflare-workers::dev/);
  // deploy: static-site is inert, cloudflare-workers refuses without the production guard, so the top level fails
  const deploy = run('just', ['deploy', 'prod'], { cwd, env: { ...env, PATH: process.env.PATH } });
  assert.notEqual(deploy.status, 0);
  assert.match(deploy.stderr, /deploy: refused/);
});

test('top-level check runs the gate of each profile and fails when either one fails (stubbed gates, no network)', { skip: skipJust }, () => {
  const { cwd, env } = initComposed(['--skip-verify']);
  for (const p of PROFILES) {
    const file = join(cwd, 'just', `${p}.just`);
    const stub = `check:\n    @if [ -e FAIL ]; then echo "gate ${p} failed" >&2; exit 1; fi\n    @echo "gate ${p} ran in $(basename "$PWD")"`;
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^check: .*$/m, stub));
  }
  const ok = run('just', ['check'], { cwd, env });
  assert.equal(ok.status, 0, ok.stderr);
  for (const p of PROFILES) assert.match(ok.stdout, new RegExp(`gate ${p} ran in ${p}`));
  assert.equal((ok.stdout.match(/^sync-check: /gm) ?? []).length, 1, 'sync-check runs once, at the root');
  for (const p of PROFILES) {
    writeFileSync(join(cwd, p, 'FAIL'), '');
    const bad = run('just', ['check'], { cwd, env });
    assert.notEqual(bad.status, 0, `a failing gate of ${p} fails just check`);
    assert.match(bad.stderr, new RegExp(`gate ${p} failed`));
    run('rm', ['-f', join(cwd, p, 'FAIL')]);
  }
});

test('smoke composed: yaw init verifies just setup && just check; a bad file in either profile fails the top-level gate (needs npm and network)', { skip: skipNet, timeout: 600000 }, () => {
  const cwd = tmp('yaw-compose-');
  const r = run(process.execPath, [YAW, 'init', '--answers', ANSWERS, '--yes'], { cwd, env: { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.match(r.stdout, /check-links: 1 page\(s\), all local links resolve/, 'the static-site gate ran');
  assert.match(r.stdout, /Tests\s+3 passed \(3\)/, 'the cloudflare-workers gate ran');

  const siteBad = join(cwd, 'static-site', 'public', 'bad.html');
  copyFileSync(join(KIT_ROOT, 'test', 'profiles', 'static-site', 'invalid.html'), siteBad);
  assert.notEqual(run('just', ['check'], { cwd }).status, 0, 'an invalid page fails just check');
  run('rm', ['-f', siteBad]);
  const workerBad = join(cwd, 'cloudflare-workers', 'src', 'bad.ts');
  copyFileSync(join(KIT_ROOT, 'test', 'profiles', 'cloudflare-workers', 'type_error.ts'), workerBad);
  assert.notEqual(run('just', ['check'], { cwd }).status, 0, 'a type error fails just check');
  run('rm', ['-f', workerBad]);
  assert.equal(run('just', ['check'], { cwd }).status, 0, 'clean again');
});

test('guards of both profiles stay active in the composed project: remote deploys are blocked, secret files stay secret', () => {
  const { cwd } = initComposed(['--skip-verify']);
  const manifest = JSON.parse(read(cwd, '.yaw/manifest.json'));
  const deny = (command) => guardDestructive({ input: { command } }, { kitRoot: KIT_ROOT, manifest });
  for (const command of ['wrangler deploy', 'npx wrangler deploy --env production', 'just cloudflare-workers::deploy prod', 'just deploy prod', 'wrangler dev --remote']) {
    assert.equal(deny(command)?.decision, 'deny', command);
  }
  assert.equal(deny('wrangler pages deploy public')?.decision, 'deny', 'static-site guard');
  assert.equal(deny('npm publish')?.decision, 'deny', 'the guards of the security module itself');
  assert.equal(deny('npx wrangler dev --local'), null, 'local work is allowed');
  const rules = loadRules({ kitRoot: KIT_ROOT, profiles: manifest.profiles });
  assert.equal(commandRule(rules, 'wrangler deploy').source, 'cloudflare-workers');
  assert.equal(secretRule(rules, 'cloudflare-workers/.dev.vars').id, 'dev-vars');
  assert.equal(secretRule(rules, 'cloudflare-workers/.dev.vars.example'), null);
});

test('removing one profile removes exactly its part (just module, mod line, gitignore block); the other is rendered flat and its code stays in its folder', { skip: skipJust }, () => {
  const { cwd, env } = initComposed(['--skip-verify']);
  const before = JSON.parse(read(cwd, '.yaw/manifest.json'));
  const mine = (m, p) => m.files.filter((f) => f.path === `just/${p}.just` || f.fragments?.some((x) => x.module === p));
  assert.ok(mine(before, 'cloudflare-workers').length >= 3, 'justfile, .gitignore and its just file');
  assert.match(read(cwd, '.gitignore'), /^\.wrangler\/$/m);

  // No command changes the profile list yet (ADR-0004, ADR-0041): edit the answers and the manifest, then update.
  writeFileSync(join(cwd, '.yaw/answers.yaml'), read(cwd, '.yaw/answers.yaml').replace('profiles: [static-site, cloudflare-workers]', 'profiles: [static-site]'));
  writeFileSync(join(cwd, '.yaw/manifest.json'), JSON.stringify({ ...before, profiles: ['static-site'] }, null, 2) + '\n');
  const up = run(process.execPath, [YAW, 'update', '--yes'], { cwd, env });
  assert.equal(up.status, 0, up.stdout + up.stderr);

  const after = JSON.parse(read(cwd, '.yaw/manifest.json'));
  assert.deepEqual(mine(after, 'cloudflare-workers'), []);
  assert.equal(existsSync(join(cwd, 'just/cloudflare-workers.just')), false);
  assert.doesNotMatch(read(cwd, 'justfile'), /cloudflare-workers/);
  assert.doesNotMatch(read(cwd, '.gitignore'), /\.wrangler/);
  assert.match(read(cwd, 'justfile'), /^import 'just\/static-site\.just'$/m);
  assert.equal(read(cwd, 'just/static-site.just'), readFileSync(join(KIT_ROOT, 'profiles', 'static-site', 'just', 'static-site.just'), 'utf8'));
  assert.ok(existsSync(join(cwd, 'cloudflare-workers', 'package.json')), 'its code is yours and stays');
  assert.ok(existsSync(join(cwd, 'static-site', 'package.json')));
  const list = run('just', ['--list'], { cwd, env });
  assert.equal(list.status, 0, list.stderr);
  assert.doesNotMatch(list.stdout, /cloudflare-workers/);
});

test('yaw update refuses when answers and manifest list different profiles', () => {
  const { cwd, env } = initComposed(['--skip-verify']);
  const answers = read(cwd, '.yaw/answers.yaml');
  writeFileSync(join(cwd, '.yaw/answers.yaml'), answers.replace('profiles: [static-site, cloudflare-workers]', 'profiles: [static-site]'));
  const up = run(process.execPath, [YAW, 'update', '--yes'], { cwd, env });
  assert.notEqual(up.status, 0);
  assert.match(up.stderr, /profiles differ: .*\[static-site\].*\[static-site, cloudflare-workers\]/);
  assert.match(read(cwd, 'justfile'), /^mod cloudflare-workers /m, 'nothing was changed');
});
