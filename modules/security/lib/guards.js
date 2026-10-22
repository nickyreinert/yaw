// Guard rules of the security module (ADR-0022): modules/security/guards.yaml plus the guards.yaml of
// the project's profiles, validated against guards.schema.json. Pure functions, no I/O besides loading.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from '../../../core/lib/yaml.js';
import { formatError } from '../../../core/lib/schema.js';
import { profileDir, schemas } from '../../../core/render/kit.js';

export function loadGuardFile(file) {
  const { value, lines } = parseDocument(readFileSync(file, 'utf8'), { file });
  const errors = schemas().validate('guards.schema.json', value, { lines });
  if (errors.length > 0) throw new Error(errors.map((e) => formatError(e, file)).join('\n'));
  return value;
}

const compile = (rules = [], source) => rules.map((r) => ({ ...r, source, re: new RegExp(r.pattern) }));

// -> { commands: [rule], secretFiles: [rule], secretAllow: [rule] } with compiled `re`
export function loadRules({ kitRoot, profiles = [] }) {
  const own = loadGuardFile(join(kitRoot, 'modules', 'security', 'guards.yaml'));
  const rules = { commands: compile(own.guards, 'security'), secretFiles: compile(own.secretFiles, 'security'), secretValues: compile(own.secretValues, 'security'), secretAllow: compile(own.secretAllow, 'security') };
  for (const p of profiles) {
    const file = join(profileDir(kitRoot, p), 'guards.yaml');
    if (!existsSync(file)) continue;
    const g = loadGuardFile(file);
    rules.commands.push(...compile(g.guards, p));
    rules.secretFiles.push(...compile(g.secretFiles, p));
    rules.secretValues.push(...compile(g.secretValues, p));
    rules.secretAllow.push(...compile(g.secretAllow, p));
  }
  return rules;
}

const fileName = (path) => String(path).replace(/\/+$/, '').split('/').pop();

// The secret-file rule a path's file name hits, or null.
export function secretRule(rules, path) {
  const name = fileName(path);
  if (!name || rules.secretAllow.some((r) => r.re.test(name))) return null;
  return rules.secretFiles.find((r) => r.re.test(name)) ?? null;
}

// The secret-value rule a stored answer value hits (a string, or a list of strings), or null (ADR-0043).
// A value that is a bare secret file name (.env, id_rsa) counts too.
export function secretValueRule(rules, value) {
  for (const v of Array.isArray(value) ? value : [value]) {
    if (typeof v !== 'string') continue;
    const hit = rules.secretValues.find((r) => r.re.test(v)) ?? (/\s/.test(v) ? null : secretRule(rules, v));
    if (hit) return hit;
  }
  return null;
}

// Words of a shell command line that could name a file (split at blanks, quotes, redirections and
// separators). Not a shell parser: the guard catches plain mentions, not obfuscation (ADR-0022).
export function commandWords(command) {
  return String(command).split(/[\s;&|<>()'"`=]+/).filter(Boolean);
}

export function commandRule(rules, command) {
  return rules.commands.find((r) => r.re.test(command)) ?? null;
}
