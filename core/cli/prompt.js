// Questions on the terminal. Prompts only when stdin is a TTY (ADR-0019).

import { createInterface } from 'node:readline/promises';
import { StringDecoder } from 'node:string_decoder';
import { colorEnabled, createStyle } from './style.js';

// Next index when an arrow key moves through `count` choices; -1 means "nothing picked yet".
export function stepChoice(index, count, key) {
  if (count === 0) return index;
  if (key === 'down') return index < 0 ? 0 : (index + 1) % count;
  if (key === 'up') return index < 0 ? count - 1 : (index - 1 + count) % count;
  return index;
}

export function createPrompter({ input = process.stdin, output = process.stdout, env = process.env } = {}) {
  let rl;
  return {
    interactive: Boolean(input.isTTY),
    style: createStyle(colorEnabled(output, env)),
    show(text) {
      output.write(text);
    },
    // Rejects when the input ends before an answer arrives (instead of hanging or exiting silently).
    // choices: values the up and down arrow keys put on the input line in a terminal (#163); typing still works.
    ask(question, { choices = [], start = -1 } = {}) {
      rl ??= createInterface({ input, output, historySize: 0 });
      const reader = rl;
      let index = start;
      const onKeypress = (_, key) => {
        if (!key || (key.name !== 'up' && key.name !== 'down')) return;
        index = stepChoice(index, choices.length, key.name);
        if (index < 0) return;
        reader.write(null, { ctrl: true, name: 'u' });
        reader.write(String(choices[index]));
      };
      const arrows = input.isTTY && choices.length > 0;
      if (arrows) input.on('keypress', onKeypress);
      return new Promise((resolve, reject) => {
        const onClose = () => {
          if (arrows) input.off('keypress', onKeypress);
          reject(new Error('input ended before all questions were answered'));
        };
        reader.once('close', onClose);
        reader.question(question).then((answer) => {
          reader.off('close', onClose);
          if (arrows) input.off('keypress', onKeypress);
          resolve(answer);
        }, reject);
      });
    },
    askSecret(question) {
      if (!input.isTTY || typeof input.setRawMode !== 'function') {
        return Promise.reject(new Error('hidden secret input requires an interactive terminal'));
      }
      rl?.close();
      rl = undefined;
      output.write(question);
      input.setRawMode(true);
      input.resume();
      return new Promise((resolve, reject) => {
        let value = '';
        const finish = (error) => {
          input.off('data', onData);
          input.off('close', onClose);
          input.off('error', onError);
          if (!input.destroyed) input.setRawMode(false);
          output.write('\n');
          if (error) reject(error);
          else resolve(value);
        };
        const onClose = () => finish(new Error('input ended before secret was entered'));
        const onError = (error) => finish(error);
        const decoder = new StringDecoder('utf8');
        const onData = (chunk) => {
          for (const character of decoder.write(chunk)) {
            if (character === '\u0003') return finish(new Error('secret input cancelled'));
            if (character === '\r' || character === '\n') return finish();
            if (character === '\u007f' || character === '\b') {
              value = [...value].slice(0, -1).join('');
            } else if (character >= ' ') value += character;
          }
        };
        input.once('close', onClose);
        input.once('error', onError);
        input.on('data', onData);
      });
    },
    close() {
      rl?.close();
    },
  };
}

export async function confirm(prompter, question) {
  const a = (await prompter.ask(`${question} [y/N] `)).trim().toLowerCase();
  return a === 'y' || a === 'yes';
}

export function terminalConfirmer(io) {
  if (io.confirm) return io.confirm;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  return async (question) => {
    const prompter = createPrompter();
    try {
      return await confirm(prompter, question);
    } finally {
      prompter.close();
    }
  };
}
