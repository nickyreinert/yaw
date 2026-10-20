// Questions on the terminal. Prompts only when stdin is a TTY (ADR-0019).

import { createInterface } from 'node:readline/promises';

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
    close() {
      rl?.close();
    },
  };
}

export async function confirm(prompter, question) {
  const a = (await prompter.ask(`${question} [y/N] `)).trim().toLowerCase();
  return a === 'y' || a === 'yes';
}
