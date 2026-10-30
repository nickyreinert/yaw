// The GitHub check next to "Use GitHub for the repo?" (#166).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { githubHint, githubStatus, withGitHubHint } from '../core/lib/github-status.js';
import { main } from '../core/cli/main.js';
import { KIT_ROOT, capture, scripted, tmp } from './helpers/fixtures.js';

function fakeGh() {
  const bin = tmp('yaw-gh-bin-');
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'gh'), 0o755);
  return bin;
}

test('github status names each reason: gh missing, not logged in, no GitHub remote', () => {
  const root = tmp('yaw-gh-');
  const missing = githubStatus({ root, env: { PATH: tmp('yaw-empty-') } });
  assert.deepEqual(missing, { ready: false, reasons: ['gh (GitHub CLI) is not installed (macOS: brew install gh)'] });
  const bin = fakeGh();
  const calls = [];
  const run = (cmd, args) => { calls.push(args.join(' ')); return { status: 1 }; };
  const home = tmp('yaw-gh-home-');
  assert.deepEqual(githubStatus({ root, env: { PATH: bin, HOME: home }, run }).reasons, ['gh is not logged in (run gh auth login)']);
  assert.deepEqual(calls, [], 'without a gh config gh is not started');
  mkdirSync(join(home, '.config', 'gh'), { recursive: true });
  writeFileSync(join(home, '.config', 'gh', 'hosts.yml'), '');
  const loggedOut = githubStatus({ root, env: { PATH: bin, HOME: home }, run });
  assert.deepEqual(calls, ['auth status --hostname github.com']);
  assert.match(loggedOut.reasons[0], /not logged in or GitHub is not reachable .*gh auth login/);
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n\turl = /srv/git/app.git\n');
  const ok = { run: () => ({ status: 0 }) };
  const env = { PATH: bin, HOME: home };
  assert.deepEqual(githubStatus({ root, env, ...ok }).reasons, ['this repository has no GitHub remote yet']);
  writeFileSync(join(root, '.git', 'config'), '[remote "origin"]\n\turl = git@github.com:me/app.git\n');
  const ready = githubStatus({ root, env, ...ok });
  assert.deepEqual(ready, { ready: true, reasons: [] });
  assert.equal(githubHint(ready), 'GitHub check: gh is installed and logged in.');
  const qs = withGitHubHint([{ id: 'tasks.use-github', hint: 'h' }, { id: 'x' }], missing);
  assert.match(qs[0].status, /^GitHub check: gh \(GitHub CLI\) is not installed.*No keeps tasks local\.$/);
  assert.equal(qs[1].status, undefined);
});

test('init without GitHub shows the check, hides the task-mode choice and says tasks are local (#166)', async () => {
  const p = scripted();
  p.ask = async (prompt) => {
    if (/Setup depth/.test(prompt)) return 'basic';
    if (/Write these files/.test(prompt)) return 'n';
    p.asked.push(prompt);
    assert.ok(p.asked.length < 100, 'interview must make progress');
    const screen = [...p.shown].reverse().find((s) => /^  \d+\/\d+ /.test(s)) ?? '';
    if (screen.includes('Purpose/Idea')) return 'A tool.';
    if (screen.includes('What language do you want')) return 'typescript';
    if (screen.includes('Where will it run')) return 'local';
    return '';
  };
  const code = await main(['init', '--skip-verify'], { stdout: capture(), stderr: capture(), cwd: tmp('yaw-proj-'), env: { PATH: tmp('yaw-empty-'), HOME: tmp('yaw-home-') }, kitRoot: KIT_ROOT, prompter: p });
  assert.equal(code, 1, 'declined at "Write these files?"');
  const shown = p.shown.join('');
  assert.match(shown, /Use GitHub for the repo\?\n.*\n {6}GitHub check: gh \(GitHub CLI\) is not installed/);
  assert.match(shown, /Task tracking: local \(TASKS\.md\), because GitHub is off for this project\./);
  assert.doesNotMatch(shown, /2\) github - GitHub only/);
});

test('settings GitHub hint does not start a network authentication probe', () => {
  const status = githubStatus({ root: tmp('yaw-gh-local-'), env: { PATH: fakeGh(), GH_TOKEN: 'test-only' }, verifyAuth: false,
    run: () => { throw new Error('settings must not start gh'); } });
  assert.equal(status.authUnchecked, true);
  assert.match(githubHint(status), /connection checked when used/);
});
