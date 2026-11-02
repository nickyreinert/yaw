// Global Settings of the dashboard: your personal defaults (~/.yaw/user-profile.yaml), saved presets and a
// read-only view of the ~/.yaw files. Only listed files can be read; nothing is followed through links, and the
// folder never holds secrets (answers only, ADR-0043). Writes: the profile (hash-checked) and preset rename/delete.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { collectQuestions, hasModule, schemas } from '../render/kit.js';
import { parseReply, validAnswer } from '../interview/engine.js';
import { asksIn } from '../interview/policy.js';
import { parse } from '../lib/yaml.js';
import { deletePreset, listPresets, nextUserProfile, readPreset, renamePreset, secretFindings, userDataDir, userDir, writePresetAnswers, writeUserProfile } from '../lib/user-store.js';
import { setupDefaults } from '../lib/setup-defaults.js';
import { assertSafe, FormError, fullFileDiff } from './form-model.js';
import { MAX_BYTES, readRegular } from './knowledge.js';

const hash = (text) => `sha256:${createHash('sha256').update(text ?? '').digest('hex')}`;
const PROFILE = 'user-profile.yaml';
const userError = (fn) => { try { return fn(); } catch (e) { throw e instanceof FormError ? e : new FormError(e.message); } };

function questions(kitRoot) {
  const known = Object.keys(schemas().schemas.get('user-profile.schema.json').properties.answers.properties);
  const modules = readdirSync(join(kitRoot, 'modules')).filter((n) => hasModule(kitRoot, n)).sort();
  return collectQuestions(kitRoot, modules).filter((q) => known.includes(q.id));
}

// -> { exists, hash, answers, questions }. Keys without a question (set by other commands) are kept as they are.
export function profileData({ kitRoot, env }) {
  const { before } = userError(() => nextUserProfile(env, {}));
  const answers = before === null ? {} : parse(before)?.answers ?? {};
  return {
    exists: before !== null, hash: hash(before), answers, path: `~/.yaw/${PROFILE}`,
    questions: questions(kitRoot).map((q) => ({
      id: q.id, type: q.type, label: q.label, hint: q.hint ?? null, choices: q.choices ?? null, default: q.default ?? null,
      assumedIn: ['quick', 'basic'].filter((depth) => !asksIn(q, depth)),
    })),
  };
}

function nextProfile({ kitRoot, env, input }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FormError('Expected your answers');
  const { answers, expected } = input;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new FormError('Expected your answers');
  const byId = new Map(questions(kitRoot).map((q) => [q.id, q]));
  if (Object.keys(answers).some((id) => !byId.has(id))) throw new FormError('Unknown answer key');
  assertSafe(answers, kitRoot);
  for (const [id, value] of Object.entries(answers)) {
    const q = byId.get(id);
    if (!validAnswer(q, value) || (q.type === 'text' && value.length > 8192)) throw new FormError(`Invalid answer for ${id}`);
    if (q.type !== 'text' && !(q.type === 'multi' && value.length === 0) && parseReply(q, Array.isArray(value) ? value.join(',') : String(value)).error) throw new FormError(`Invalid answer for ${id}`);
  }
  const next = userError(() => nextUserProfile(env, answers));
  if (expected !== hash(next.before)) throw new FormError(`${PROFILE} changed on disk; reload before saving`, 409);
  return next;
}

export function profilePreview({ kitRoot, env, input }) {
  const { before, after } = nextProfile({ kitRoot, env, input });
  return { changed: (before ?? '') !== after, diff: fullFileDiff(`~/.yaw/${PROFILE}`, before ?? '', after) };
}

export function profileApply({ kitRoot, env, input }) {
  const { before, after } = nextProfile({ kitRoot, env, input });
  if ((before ?? '') !== after) userError(() => writeUserProfile(env, after));
  return { hash: hash(after), message: (before ?? '') === after ? 'Nothing changed.' : `Saved ~/.yaw/${PROFILE}. New projects start with these answers; existing projects keep theirs.` };
}

export function presetsData({ env }) {
  return { presets: userError(() => listPresets(env)) };
}

// One preset's answers for the Defaults tab, with a hash so a save cannot overwrite a newer file.
export function presetData({ env, name }) {
  const text = userError(() => readPreset(env, String(name ?? '')));
  let doc;
  try { doc = parse(text) ?? {}; } catch { throw new FormError('Saved preset is unreadable or invalid'); }
  return { name: doc.name, description: doc.description ?? '', mode: doc.mode ?? '', answers: doc.answers ?? {}, hash: hash(text) };
}

// Only questions shown on the Defaults tab may be edited: personal answers and workflow defaults.
export function presetSave({ kitRoot, env, input }) {
  if (!input || typeof input !== 'object' || typeof input.name !== 'string') throw new FormError('Choose a preset');
  const { name, answers, expected } = input;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new FormError('Expected your answers');
  const byId = new Map([...questions(kitRoot), ...setupDefaults({ env, kitRoot }, {}).questions].map((q) => [q.id, q]));
  if (Object.keys(answers).some((id) => !byId.has(id))) throw new FormError('Unknown answer key');
  assertSafe(answers, kitRoot);
  for (const [id, value] of Object.entries(answers)) {
    const q = byId.get(id);
    if (!validAnswer(q, value) || (q.type === 'text' && value.length > 8192)) throw new FormError(`Invalid answer for ${id}`);
  }
  if (secretFindings({ answers, kitRoot }).length) throw new FormError('An answer looks like a secret; nothing was saved');
  if (expected !== presetData({ env, name }).hash) throw new FormError(`presets/${name}.yaml changed on disk; reload before saving`, 409);
  userError(() => writePresetAnswers(env, name, answers));
  return { message: Object.keys(answers).length ? `Saved preset ${name}.` : 'Nothing changed.' };
}

export function presetAction({ env, input, remove }) {
  if (!input || typeof input.name !== 'string') throw new FormError('Choose a preset');
  if (remove) {
    if (input.confirm !== true) throw new FormError('Confirm deleting the preset');
    userError(() => deletePreset(env, input.name));
    return { message: `Deleted preset ${input.name}.` };
  }
  const to = userError(() => renamePreset(env, input.name, input.to));
  return { name: to, message: `Renamed preset ${input.name} to ${to}.` };
}

// Every file the dashboard may show. `base` is the folder it lives in (YAW_HOME can move the data files).
const FILES = [
  ['Your settings', [
    [PROFILE, 'user', 'Your defaults for new projects (Defaults tab).'],
    ['notification-settings.json', 'data', 'Personal notification channels (Notifications tab). Holds variable names, never tokens.'],
    ['web-preferences.json', 'data', 'Dashboard: Auto refresh for Sessions pages and the local Laya classifier settings.'],
    ['improve-settings.json', 'data', 'Improve review destinations: enabled CLI names and the default browser or CLI target; no conversation text.'],
    ['web-projects.json', 'data', 'Projects added to the dashboard project switcher.'],
  ]],
  ['Presets', []],
  ['Collected data', [
    ['session-sources.json', 'data', 'The folders Sessions › Refresh reads (Global settings → Sessions).'],
    ['session-analysis.json', 'data', 'Saved session scan: counts, lengths and timing; never message text.'],
    ['history.jsonl', 'user', 'Setup history: one line per saved yaw init.'],
    ['notification-delivery.json', 'data', 'Last notification deliveries, used to avoid duplicates.'],
  ]],
];
const RUNTIME = [['kit', 'Installed YAW kit (yaw self-update).'], ['state', 'Hook state of the comfort and tasks modules.'], ['logs', 'Logs.'], ['web', 'Dashboard server state.']];
const stat = (path) => { try { return lstatSync(path); } catch { return null; } };

export function globalFiles({ env }) {
  const bases = { user: userDir(env), data: userDataDir(env) };
  const entry = (path, base, about) => {
    const st = stat(join(bases[base], ...path.split('/')));
    if (!st) return { path, base, about, missing: true };
    if (st.isSymbolicLink() || !st.isFile()) return { path, base, about, blocked: true };
    return { path, base, about, size: st.size, modified: st.mtime.toISOString() };
  };
  const groups = FILES.map(([title, files]) => ({ title, files: files.map(([path, base, about]) => entry(path, base, about)) }));
  let presets = [];
  try { presets = readdirSync(join(bases.user, 'presets')).filter((f) => /^[a-z0-9][a-z0-9-]*\.yaml$/.test(f)).sort(); } catch { /* no presets yet */ }
  groups[1].files = presets.map((f) => entry(`presets/${f}`, 'user', 'Saved setup; yaw init --preset uses it.'));
  const runtime = RUNTIME.map(([name, about]) => {
    const st = stat(join(bases.user, name));
    if (!st?.isDirectory() || st.isSymbolicLink()) return null;
    let entries = 0;
    try { entries = readdirSync(join(bases.user, name)).length; } catch { /* unreadable */ }
    return { path: `${name}/`, about, folder: true, entries };
  }).filter(Boolean);
  if (runtime.length) groups.push({ title: 'YAW runtime', files: runtime });
  return { dir: bases.user, dataDir: bases.data === bases.user ? null : bases.data, groups: groups.filter((g) => g.files.length) };
}

// One listed file, plus a parsed copy for the Form view. Anything not listed is refused without a read.
export function globalFile({ env, path }) {
  const file = globalFiles({ env }).groups.flatMap((g) => g.files).find((f) => !f.folder && f.path === path);
  if (!file || file.missing || file.blocked) throw new FormError('File unavailable', 404);
  if (file.size > MAX_BYTES) return { ...file, content: null, tooLarge: true, limit: MAX_BYTES };
  const base = file.base === 'data' ? userDataDir(env) : userDir(env);
  let content;
  try { content = readRegular(base, path); } catch { throw new FormError('File unavailable', 404); }
  let data = null;
  try {
    data = path.endsWith('.json') ? JSON.parse(content) : path.endsWith('.jsonl') ? content.split('\n').filter(Boolean).map((l) => JSON.parse(l)) : parse(content);
  } catch { data = null; }
  return { ...file, content, data };
}
