// Personal comfort configuration (ADR-0030, ADR-0013): ~/.yaw/comfort.yaml. It lives in the user's home, so it
// can never be committed; YAW reads it and never writes it (comments and the ntfy topic stay as the user left
// them). Everything the hooks learn from files or the environment is checked first and fails open: a broken
// file means defaults, never an error in the session.

import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parseDocument } from '../../../core/lib/yaml.js';
import { formatError } from '../../../core/lib/schema.js';
import { schemas } from '../../../core/render/kit.js';
import { readAnswers } from '../../../core/render/project.js';
import { yawHome } from '../../../core/hooks/dispatch.js';

export const FEATURES = ['hygiene', 'status-line', 'notifications'];
export const DEFAULT_FEATURES = ['hygiene', 'status-line'];
export const DEFAULTS = {
  hygiene: { drift: 0.9, maxPrompts: 60, maxAgeMinutes: 180, maxKbPerPrompt: 100, cooldownPrompts: 20 },
  notify: { minutes: 3, terminal: 'osc9' },
};
const MAX_BYTES = 64 * 1024;

// The user's .yaw directory, or null when it is not an absolute path (a relative YAW_HOME would resolve against
// whatever directory the agent runs in).
export function homeDir(env) {
  const home = yawHome(env ?? {});
  return typeof home === 'string' && isAbsolute(home) && !/[\u0000-\u001f\u007f]/.test(home) ? home : null;
}

// A regular file (no link) of at most `max` bytes -> its text, else null.
export function readSmallFile(file, max = MAX_BYTES) {
  try {
    const st = lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile() || st.size > max) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// -> { config, error }: the validated personal file ({} when it does not exist) or the reason it is unusable.
export function readPersonal(env) {
  const home = homeDir(env);
  if (home === null) return { config: {}, error: 'no absolute YAW_HOME / HOME' };
  const file = join(home, 'comfort.yaml');
  let st;
  try {
    st = lstatSync(file);
  } catch {
    return { config: {}, error: null };
  }
  const text = st.isFile() && !st.isSymbolicLink() ? readSmallFile(file) : null;
  if (text === null) return { config: {}, error: `${file} must be a regular file of at most ${MAX_BYTES} bytes` };
  try {
    const { value, lines } = parseDocument(text, { file });
    const errors = schemas().validate('comfort.schema.json', value ?? {}, { lines });
    if (errors.length > 0) return { config: {}, error: errors.map((e) => formatError(e, file)).join('; ') };
    return { config: value ?? {}, error: null };
  } catch (e) {
    return { config: {}, error: String(e.message).slice(0, 300) };
  }
}

export function settings(personal) {
  return {
    hygiene: { ...DEFAULTS.hygiene, ...(personal.hygiene ?? {}) },
    notify: { ...DEFAULTS.notify, ...(personal.notify ?? {}) },
  };
}

// The features on for this user in this project. Order: the personal file; then, in a solo project, the project's
// user.comfort answer; then the defaults. A team project's answers are somebody else's choices (ADR-0013).
// -> { features: [...], source: 'personal' | 'project' | 'default', team: boolean }
export function resolveFeatures({ root, personal }) {
  let answers = {};
  try {
    answers = readAnswers(root).answers ?? {};
  } catch { /* no answers file: defaults */ }
  const team = (answers['idea.team'] ?? 'solo') !== 'solo';
  const valid = (list) => Array.isArray(list) && list.every((f) => FEATURES.includes(f));
  if (valid(personal.features)) return { features: personal.features, source: 'personal', team };
  if (!team && valid(answers['user.comfort'])) return { features: answers['user.comfort'], source: 'project', team };
  return { features: DEFAULT_FEATURES, source: 'default', team };
}
