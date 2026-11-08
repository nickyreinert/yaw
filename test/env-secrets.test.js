import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { envFileExists, envNames, validateSecretValues, writeEnvSecrets } from '../core/lib/env-secrets.js';
import { createPrompter } from '../core/cli/prompt.js';
import { main } from '../core/cli/main.js';
import { capture, fakeJust, KIT_ROOT, scripted, tmp } from './helpers/fixtures.js';
import { PassThrough } from 'node:stream';

test('env secret names come only from assignments and never include template values', () => {
  assert.deepEqual(envNames('# key\nexport API_KEY=placeholder\nDATABASE_URL=\nAPI_KEY=duplicate'), ['API_KEY', 'DATABASE_URL']);
});

test('secret entry creates a private new .env with dotenv-quoted values and never overwrites', () => {
  const root = tmp('yaw-secret-project-');
  const names = envNames('API_KEY=\nDATABASE_URL=\n');
  assert.equal(envFileExists(root), false);
  const value = 'canary "secret" $with punctuation';
  assert.deepEqual(Object.fromEntries(Object.entries(validateSecretValues({ API_KEY: value, DATABASE_URL: '' }, names))), { API_KEY: value });
  assert.deepEqual(writeEnvSecrets(root, names, { API_KEY: value }), { written: 1, preserved: false });
  const path = join(root, '.env');
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(readFileSync(path, 'utf8'), `API_KEY=${JSON.stringify(value)}\nDATABASE_URL=\n`);
  assert.deepEqual(writeEnvSecrets(root, names, { API_KEY: 'replacement' }), { written: 0, preserved: true });
  assert.equal(readFileSync(path, 'utf8'), `API_KEY=${JSON.stringify(value)}\nDATABASE_URL=\n`);
  assert.throws(() => validateSecretValues({ UNKNOWN: 'canary' }, names), /listed variable name/);
  assert.throws(() => validateSecretValues({ API_KEY: 'x\0y' }, names), /listed variable name/);
  assert.throws(() => validateSecretValues({ API_KEY: 'line1\nline2' }, names), /single-line value/);
});

test('secret prompt does not echo typed characters and restores cooked terminal mode', async () => {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = (enabled) => { input.rawMode = enabled; };
  const output = capture();
  const prompt = createPrompter({ input, output });
  const pending = prompt.askSecret('API_KEY > ');
  input.write('canary-value');
  input.write('\n');
  assert.equal(await pending, 'canary-value');
  assert.equal(output.text(), 'API_KEY > \n');
  assert.equal(input.rawMode, false);
  prompt.close();
});

test('secret prompt handles Ctrl+C without echoing a partial value', async () => {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = (enabled) => { input.rawMode = enabled; };
  const output = capture();
  const prompt = createPrompter({ input, output });
  const pending = prompt.askSecret('API_KEY > ');
  input.write('partial-canary');
  input.write('\u0003');
  await assert.rejects(pending, /secret input cancelled/);
  assert.equal(output.text(), 'API_KEY > \n');
  assert.equal(input.rawMode, false);
  prompt.close();
});

test('CLI secret entry uses hidden input and keeps values out of answers, logs and user saves', async () => {
  const kitRoot = tmp('yaw-secret-kit-');
  for (const dir of ['core', 'modules', 'profiles', 'interview', 'adapters']) {
    cpSync(join(KIT_ROOT, dir), join(kitRoot, dir), { recursive: true });
  }
  cpSync(join(KIT_ROOT, 'package.json'), join(kitRoot, 'package.json'));
  writeFileSync(join(kitRoot, 'profiles/node-cli/env.example'), 'API_KEY=\n');
  const root = tmp('yaw-secret-cli-'), home = tmp('yaw-secret-home-'), bin = tmp('yaw-secret-bin-');
  const log = fakeJust(bin);
  const stdout = capture(), stderr = capture(), prompter = scripted(['y']);
  const answersFile = join(root, 'answers.yaml');
  writeFileSync(answersFile, readFileSync(join(KIT_ROOT, 'examples/node-cli/answers.yaml'), 'utf8')
    .replace('modules: [core]', 'modules: [core, communication, devenv, security, standards, tasks]'));
  const canary = 'CLI_SECRET_CANARY_81cf';
  prompter.askSecret = async (question) => {
    prompter.asked.push(question);
    return canary;
  };
  const code = await main(['init', '--answers', answersFile], {
    stdout, stderr, cwd: root, env: { HOME: home, PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(':') }, kitRoot, prompter,
  });
  assert.equal(code, 0, stderr.text());
  assert.match(stdout.text(), /verification skipped because new secrets were saved/);
  assert.equal(existsSync(log), false, 'project-controlled verification recipes were not started');
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), `API_KEY=${JSON.stringify(canary)}\n`);
  assert.equal(statSync(join(root, '.env')).mode & 0o777, 0o600);
  assert.doesNotMatch(stdout.text() + stderr.text(), /CLI_SECRET_CANARY_81cf/);
  assert.doesNotMatch(readFileSync(join(root, '.yaw/answers.yaml'), 'utf8'), /CLI_SECRET_CANARY_81cf/);
  // T-027: only the personal settings are saved, without the secret.
  assert.deepEqual(readdirSync(join(home, '.yaw')), ['user-profile.yaml']);
  assert.doesNotMatch(readFileSync(join(home, '.yaw/user-profile.yaml'), 'utf8'), /CLI_SECRET_CANARY_81cf/);
});
