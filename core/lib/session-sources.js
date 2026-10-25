// Where YAW looks for each agent's session history (Global settings → Sessions). Without a saved choice the usual
// folders are used; the page can suggest others, and the user may edit, remove or add their own. Folders only,
// never files: the readers below them decide which files are histories.
import { isAbsolute, resolve } from 'node:path';
import { FORMATS, defaultSources, probeSource, suggestedSources } from '../../modules/sessions/lib/import.js';
import { readUserData, writeUserData } from './user-store.js';

const FILE = 'session-sources.json';
const MAX_SOURCES = 40;

// -> [{ agent, path }] the folders a scan reads
export function effectiveSources(env) {
  const saved = readUserData(env, FILE);
  if (!saved) return defaultSources(env).map(({ agent, path }) => ({ agent, path }));
  return saved.sources.filter((s) => s.enabled !== false).map(({ agent, path }) => ({ agent, path }));
}

// Everything the settings page shows: the saved list (or the defaults as a starting point), suggestions and file counts.
export function sourcesData(env, { counts = true } = {}) {
  const saved = readUserData(env, FILE);
  const defaults = defaultSources(env);
  const sources = (saved ? saved.sources : defaults.map((d) => ({ agent: d.agent, path: d.path, enabled: true }))).map((s) => ({
    agent: s.agent, path: s.path, enabled: s.enabled !== false, files: counts ? probeSource(s) : undefined,
  }));
  const taken = new Set(sources.map((s) => `${s.agent}\0${s.path}`));
  const suggestions = [...defaults, ...suggestedSources(env)].filter((s) => !taken.has(`${s.agent}\0${s.path}`))
    .map((s) => ({ ...s, files: counts ? probeSource(s) : undefined })).filter((s) => s.files !== null);
  return { custom: Boolean(saved), formats: FORMATS, sources, suggestions, defaults: defaults.map(({ agent, path }) => ({ agent, path })) };
}

export function saveSources(env, input) {
  if (!Array.isArray(input) || input.length > MAX_SOURCES) throw new Error(`Give at most ${MAX_SOURCES} session folders`);
  const seen = new Set(), sources = [];
  for (const s of input) {
    if (!s || typeof s !== 'object' || !Object.hasOwn(FORMATS, s.agent)) throw new Error(`Format must be one of ${Object.keys(FORMATS).join(', ')}`);
    if (typeof s.path !== 'string' || !isAbsolute(s.path) || s.path.length > 1024 || /[\u0000-\u001f\u007f]/.test(s.path)) throw new Error('Each folder must be an absolute path');
    const path = resolve(s.path), id = `${s.agent}\0${path}`;
    if (seen.has(id)) continue;
    seen.add(id); sources.push({ agent: s.agent, path, enabled: s.enabled !== false });
  }
  writeUserData(env, FILE, { version: 1, sources });
  return sourcesData(env);
}

export function resetSources(env) {
  writeUserData(env, FILE, null);
  return sourcesData(env);
}
