// Questions on the terminal. Prompts only when stdin is a TTY (ADR-0019).

import { createInterface } from 'node:readline/promises';

export function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  let rl;
  return {
    interactive: Boolean(input.isTTY),
    show(text) {
      output.write(text);
    },
    async ask(question) {
      rl ??= createInterface({ input, output });
      return rl.question(question);
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
