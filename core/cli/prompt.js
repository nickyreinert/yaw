// Questions on the terminal. Prompts only when stdin is a TTY (ADR-0019).

import { createInterface } from 'node:readline/promises';
import { StringDecoder } from 'node:string_decoder';

export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  let rl;
  return {
    interactive: Boolean(input.isTTY),
    show(text) {
      output.write(text);
    },
    // Rejects when the input ends before an answer arrives (instead of hanging or exiting silently).
    ask(question) {
      rl ??= createInterface({ input, output });
      const reader = rl;
      return new Promise((resolve, reject) => {
        const onClose = () => reject(new Error('input ended before all questions were answered'));
        reader.once('close', onClose);
        reader.question(question).then((answer) => {
          reader.off('close', onClose);
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
