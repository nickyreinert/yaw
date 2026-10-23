// Terminal styling with plain ANSI codes, no dependencies (#163). Colour only on a TTY; NO_COLOR or TERM=dumb turn it off.

const CODES = { bold: [1, 22], dim: [2, 22], cyan: [36, 39], green: [32, 39], yellow: [33, 39] };

export function colorEnabled(output, env = process.env) {
  if (!output?.isTTY) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  return env.TERM !== 'dumb';
}

export function createStyle(enabled) {
  const style = { enabled };
  for (const [name, [on, off]] of Object.entries(CODES)) {
    style[name] = enabled ? (text) => `\u001b[${on}m${text}\u001b[${off}m` : (text) => String(text);
  }
  return style;
}

export const PLAIN = createStyle(false);
