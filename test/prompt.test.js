// Terminal prompter (#163): colour only on a TTY without NO_COLOR, arrow keys move through choices.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createPrompter, stepChoice } from '../core/cli/prompt.js';
import { colorEnabled, createStyle } from '../core/cli/style.js';
import { runInterview } from '../core/interview/engine.js';

function tty() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => input;
  const output = new PassThrough();
  output.isTTY = true;
  output.columns = 80;
  let text = '';
  output.on('data', (d) => { text += d; });
  return { input, output, text: () => text };
}

test('colour: on for a TTY, off for NO_COLOR, TERM=dumb and pipes', () => {
  assert.equal(colorEnabled({ isTTY: true }, {}), true);
  assert.equal(colorEnabled({ isTTY: true }, { NO_COLOR: '1' }), false);
  assert.equal(colorEnabled({ isTTY: true }, { NO_COLOR: '' }), true, 'an empty NO_COLOR does not count (no-color.org)');
  assert.equal(colorEnabled({ isTTY: true }, { TERM: 'dumb' }), false);
  assert.equal(colorEnabled({ isTTY: false }, {}), false);
  assert.equal(createStyle(false).green('x'), 'x');
  assert.equal(createStyle(true).green('x'), '\u001b[32mx\u001b[39m');
});

test('stepChoice wraps around and starts from the default', () => {
  assert.equal(stepChoice(-1, 3, 'down'), 0);
  assert.equal(stepChoice(-1, 3, 'up'), 2);
  assert.equal(stepChoice(2, 3, 'down'), 0);
  assert.equal(stepChoice(0, 3, 'up'), 2);
  assert.equal(stepChoice(1, 3, 'left'), 1);
  assert.equal(stepChoice(-1, 0, 'down'), -1);
});

test('a TTY interview is coloured, marks the default green, and the arrow keys pick a choice', async () => {
  const t = tty();
  const prompter = createPrompter({ input: t.input, output: t.output, env: {} });
  const questions = [{ id: 'arch.language', label: 'Language?', type: 'choice', mode: 'Q', section: 'Stack', choices: ['python', 'javascript', 'go'], default: 'python', hint: 'pick one' }];
  const running = runInterview({ questions, mode: 'quick', prompter });
  await new Promise((r) => setImmediate(r));
  t.input.write('\u001b[B'); // down: from the default python to javascript
  t.input.write('\u001b[B'); // go
  t.input.write('\u001b[A'); // up: back to javascript
  t.input.write('\r');
  const r = await running;
  prompter.close();
  assert.deepEqual(r.answers, { 'arch.language': 'javascript' });
  const out = t.text();
  assert.match(out, /\u001b\[1mLanguage\?\u001b\[22m/, 'bold title');
  assert.match(out, /\u001b\[2mpick one\u001b\[22m/, 'dim hint');
  assert.match(out, /\u001b\[36m1\)\u001b\[39m \u001b\[32m\u001b\[1mpython\u001b\[22m\u001b\[39m/, 'default choice is green');
  assert.match(out, /\u001b\[36m2\)\u001b\[39m javascript\n/);
});

test('NO_COLOR and a scripted prompter keep the plain output; typed replies still work in a TTY', async () => {
  const t = tty();
  const prompter = createPrompter({ input: t.input, output: t.output, env: { NO_COLOR: '1' } });
  const questions = [{ id: 'x', label: 'Pick?', type: 'choice', mode: 'Q', section: 'S', choices: ['a', 'b'], default: 'a' }];
  const running = runInterview({ questions, mode: 'quick', prompter });
  await new Promise((r) => setImmediate(r));
  t.input.write('b\r');
  assert.deepEqual((await running).answers, { x: 'b' });
  prompter.close();
  assert.doesNotMatch(t.text(), /\u001b\[(1|2|3\d)m/);
  assert.match(t.text(), / {6}1\) a\n {6}2\) b\n/);
});
