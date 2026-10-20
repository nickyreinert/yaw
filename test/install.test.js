// End-to-end (Y-2 done-when): install.sh in a temp HOME (twice: idempotent) -> yaw init (core only)
// -> yaw update -> yaw remove core; then self-update and self-uninstall (Y-2.8).
// install.sh runs under /bin/bash, which is bash 3.2 on macOS (ADR-0008).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_ROOT, cleanEnv, makeKitRepo, readTree, run, tmp, writeAnswers } from './helpers/fixtures.js';

function install(home, src, args = [], extraEnv = {}) {
  return run('/bin/bash', [join(src, 'install.sh'), ...args], { env: cleanEnv(home, { YAW_REPO: src, ...extraEnv }), cwd: home });
}

const git = (cwd, args, env) => run('git', args, { cwd, env }).stdout.trim();

// Files outside .git (fetch rewrites FETCH_HEAD, which is not a change to the install).
function snapshot(home) {
  const kit = join(home, '.yaw', 'kit');
  const files = Object.keys(readTree(kit)).filter((p) => !p.startsWith('.git/'));
  return {
    head: git(kit, ['rev-parse', 'HEAD']),
    channel: git(kit, ['config', '--get', 'yaw.channel']),
    link: readlinkSync(join(home, '.local', 'bin', 'yaw')),
    files,
  };
}

test('install.sh: clone, link, PATH hint; a second run is a no-op', () => {
  const home = tmp('yaw-home-');
  const src = makeKitRepo(tmp('yaw-src-'), { env: cleanEnv(home) });
  const first = install(home, src);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /^yaw 0\.0\.0: cloned .*\/\.yaw\/kit, checked out v0\.0\.0 \(channel: tag\)$/m);
  assert.match(first.stdout, /^linked .*\/\.local\/bin\/yaw -> .*\/\.yaw\/kit\/bin\/yaw$/m);
  assert.match(first.stdout, /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
  assert.match(first.stdout, /uninstall: yaw self-uninstall/);
  const before = snapshot(home);
  assert.equal(before.head, git(src, ['rev-parse', 'v0.0.0^{commit}']));
  assert.equal(before.channel, 'tag');
  assert.ok(lstatSync(join(home, '.local', 'bin', 'yaw')).isSymbolicLink());

  const second = install(home, src);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /fetched .*, already at v0\.0\.0 \(channel: tag\)/);
  assert.match(second.stdout, /link already in place/);
  assert.deepEqual(snapshot(home), before);

  // with ~/.local/bin on PATH there is no PATH hint
  const third = install(home, src, [], { PATH: `${join(home, '.local', 'bin')}:${cleanEnv(home).PATH}` });
  assert.doesNotMatch(third.stdout, /export PATH/);
});

test('install.sh: --channel main, --tag, and the channel is kept on re-runs', () => {
  const home = tmp('yaw-home-');
  const src = makeKitRepo(tmp('yaw-src-'), { env: cleanEnv(home) });
  assert.equal(install(home, src, ['--channel', 'main']).status, 0);
  assert.equal(snapshot(home).channel, 'main');
  const again = install(home, src);
  assert.match(again.stdout, /already at origin\/main \(channel: main\)/);
  const tagged = install(home, src, ['--tag', '0.0.0']);
  assert.equal(tagged.status, 0, tagged.stderr);
  assert.match(tagged.stdout, /v0\.0\.0 \(channel: tag\)/);
  assert.equal(snapshot(home).channel, 'tag');
});

test('install.sh: refuses bad options, unknown tags, missing tools, and pre-tag installs without --channel main', () => {
  const home = tmp('yaw-home-');
  const src = makeKitRepo(tmp('yaw-src-'), { env: cleanEnv(home), tag: null });
  for (const [args, re] of [
    [['--frob'], /unknown option: --frob/],
    [['--channel', 'dev'], /--channel accepts only main/],
    [['--tag', 'v1', '--channel', 'main'], /use either --tag or --channel/],
  ]) {
    const r = install(home, src, args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, re);
  }
  assert.ok(!existsSync(join(home, '.yaw')), 'nothing written for bad options');

  const pre = install(home, src);
  assert.equal(pre.status, 1);
  assert.match(pre.stderr, /no release tag yet; run install.sh --channel main/);
  const unknown = install(home, src, ['--tag', 'v9.9.9']);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /tag v9\.9\.9 not found/);
  const main = install(home, src, ['--channel', 'main']);
  assert.equal(main.status, 0, main.stderr);

  // a PATH with git but no node: hints, exit 1, nothing installed
  const bin = tmp('yaw-bin-');
  symlinkSync(realpathSync(run('/bin/sh', ['-c', 'command -v git']).stdout.trim()), join(bin, 'git'));
  const home2 = tmp('yaw-home-');
  const noNode = install(home2, src, [], { PATH: bin });
  assert.equal(noNode.status, 1);
  assert.match(noNode.stdout, /missing: node >= 22\.13/);
  assert.match(noNode.stderr, /installs nothing itself/);
  assert.ok(!existsSync(join(home2, '.yaw')));

  // a too-old node
  writeFileSync(join(bin, 'node'), '#!/bin/sh\n[ "$1" = --version ] && echo v20.0.0\nexit 1\n', { mode: 0o755 });
  const old = install(home2, src, [], { PATH: bin });
  assert.equal(old.status, 1);
  assert.match(old.stdout, /too old: node v20\.0\.0, YAW needs >= 22\.13/);
});

test('install -> init (core only) -> update -> remove, then self-update and self-uninstall', () => {
  const home = tmp('yaw-home-');
  const env = cleanEnv(home);
  const src = makeKitRepo(tmp('yaw-src-'), { env });
  assert.equal(install(home, src).status, 0);
  const pathEnv = { ...env, PATH: `${join(home, '.local', 'bin')}:${env.PATH}` };
  const project = tmp('yaw-proj-');
  const yaw = (args, cwd = project) => run('yaw', args, { cwd, env: pathEnv });

  assert.equal(yaw(['--version']).stdout, 'yaw 0.0.0\n');
  const answers = writeAnswers(tmp('yaw-ans-'));
  const init = yaw(['init', '--answers', answers, '--yes', '--skip-verify']);
  assert.equal(init.status, 0, init.stderr);
  assert.ok(Object.keys(readTree(project)).includes('AGENTS.md') && Object.keys(readTree(project)).includes('justfile'));

  const update = yaw(['update', '--yes']);
  assert.equal(update.status, 0, update.stderr);
  assert.match(update.stdout, /nothing to do/);

  assert.equal(yaw(['status']).status, 0);
  const doctor = yaw(['doctor']);
  assert.equal(doctor.status, 0, doctor.stdout);
  assert.match(doctor.stdout, /^ok {4}yaw on PATH -> /m);
  assert.match(doctor.stdout, /\(channel: tag\)/);
  assert.match(doctor.stdout, /^ok {4}project pinned to kit 0\.0\.0 = installed kit$/m);

  const remove = yaw(['remove', 'core', '--yes']);
  assert.equal(remove.status, 0, remove.stderr);
  // what stays: the answers and the scaffold, which is your code
  assert.deepEqual(Object.keys(readTree(project)), ['.yaw/answers.yaml', 'package.json', 'src/index.js', 'test/index.test.js']);

  // self-update: a new tag with a changelog entry in the kit repo
  const pkg = JSON.parse(readTree(src)['package.json']);
  writeFileSync(join(src, 'package.json'), `${JSON.stringify({ ...pkg, version: '0.0.1' }, null, 2)}\n`);
  writeFileSync(join(src, 'CHANGELOG.md'), '# Changelog\n\n## 0.0.1\n\n- Test release.\n');
  git(src, ['add', '-A'], env);
  git(src, ['commit', '--quiet', '-m', 'release 0.0.1'], env);
  git(src, ['tag', 'v0.0.1'], env);
  const up = yaw(['self-update'], home);
  assert.equal(up.status, 0, up.stderr);
  assert.match(up.stdout, /changes 0\.0\.0 -> 0\.0\.1 \(v0\.0\.1\):/);
  assert.match(up.stdout, /- Test release\./);
  assert.match(up.stdout, /switched kit 0\.0\.0 -> 0\.0\.1/);
  assert.equal(yaw(['--version']).stdout, 'yaw 0.0.1\n');
  assert.match(yaw(['self-update'], home).stdout, /kit 0\.0\.1 is up to date \(v0\.0\.1\)/);
  const back = yaw(['self-update', '--tag', '0.0.0'], home);
  assert.equal(back.status, 0, back.stderr);
  assert.equal(yaw(['--version']).stdout, 'yaw 0.0.0\n');

  // a development checkout is never touched by self-update / self-uninstall
  const dev = run(process.execPath, [join(KIT_ROOT, 'bin', 'yaw'), 'self-update'], { env: pathEnv });
  assert.equal(dev.status, 1);
  assert.match(dev.stderr, /work only on the kit installed by install\.sh/);

  // self-uninstall: needs --yes without a terminal, removes kit and link only
  mkdirSync(join(home, '.yaw', 'presets'));
  const refused = yaw(['self-uninstall'], home);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /confirmation needed/);
  const un = yaw(['self-uninstall', '--yes'], home);
  assert.equal(un.status, 0, un.stderr);
  assert.match(un.stdout, /still there:\n {2}.*\/\.yaw\/presets\n/);
  assert.ok(!existsSync(join(home, '.yaw', 'kit')));
  assert.ok(!existsSync(join(home, '.local', 'bin', 'yaw')));
  assert.ok(existsSync(join(home, '.yaw', 'presets')));
});
