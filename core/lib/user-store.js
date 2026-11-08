// The user folder ~/.yaw/ (Y-7.2, ADR-0043, doc 02 §5): user profile, saved setups ("presets"), history.jsonl.
// Created only after the user opted in; files 0600, folders 0700; answers only, never secrets (doc 08).

import { closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { PERSONAL_PREFERENCES } from '../interview/policy.js';
import { depthOf } from '../interview/depth.js';
import { parse, stringify, YamlError } from './yaml.js';
import { formatError } from './schema.js';
import { schemas, KIT_ROOT } from '../render/kit.js';
import { loadRules, secretValueRule } from '../../modules/security/lib/guards.js';

export const PRESET_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function userDir(env = process.env) {
  return join(env.HOME || env.USERPROFILE || homedir(), '.yaw');
}

const profileFile = (env) => join(userDir(env), 'user-profile.yaml');
const presetsDir = (env) => join(userDir(env), 'presets');
const presetFile = (env, name) => join(presetsDir(env), `${name}.yaml`);

const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

function existingStat(path) {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) throw new Error(`${path} must be a regular file, not a symbolic link`);
    return st;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

function directory(path, create = false) {
  if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
  let expected;
  try {
    expected = lstatSync(path);
  } catch (e) {
    if (!create && e.code === 'ENOENT') return false;
    throw e;
  }
  if (expected.isSymbolicLink() || !expected.isDirectory()) throw new Error(`${path} must be a real directory, not a symbolic link`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const actual = fstatSync(fd);
    if (!actual.isDirectory() || !sameFile(expected, actual)) throw new Error(`${path} changed while opening`);
    if (create) fchmodSync(fd, 0o700);
  } finally {
    closeSync(fd);
  }
  return true;
}

function read(path) {
  const expected = existingStat(path);
  if (!expected) throw new Error(`${path} does not exist`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const actual = fstatSync(fd);
    if (!actual.isFile() || !sameFile(expected, actual)) throw new Error(`${path} changed while opening`);
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}

// Appends in place; otherwise publishes a complete private file by rename (replace) or link (exclusive: EEXIST if it exists),
// so a failed write leaves the previous file intact and a reader never sees a truncated one.
function write(path, text, { append = false, exclusive = false } = {}) {
  let fd;
  if (append) {
    try {
      fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_APPEND, 0o600);
      if (!fstatSync(fd).isFile()) throw new Error(`${path} must be a regular file`);
      fchmodSync(fd, 0o600);
      writeFileSync(fd, text);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    return;
  }
  const temp = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    if (exclusive) linkSync(temp, path);
    else renameSync(temp, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temp, { force: true });
  }
}

// Answers that must not be stored: [{ key, rule }]. Reports key and rule id, never the value.
// Keys follow the question-id pattern of common.schema.json (no secret-type words); values follow the
// secretValues and secretFiles rules of the security module.
export function secretFindings({ answers, kitRoot }) {
  const keyPattern = new RegExp(schemas().schemas.get('common.schema.json').$defs.questionId.pattern);
  const rules = loadRules({ kitRoot });
  const found = [];
  for (const [key, value] of Object.entries(answers)) {
    if (!keyPattern.test(key)) found.push({ key, rule: 'secret-type key' });
    else {
      const rule = secretValueRule(rules, value);
      if (rule) found.push({ key, rule: rule.id });
    }
  }
  return found;
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';

function check(file, name, doc) {
  const errors = schemas().validate(name, doc);
  if (errors.length > 0) throw new Error(`not saved, ${file} would be invalid: ${errors.map((e) => formatError(e, file)).join('; ')}`);
}

// Save the setup as a preset with a history line (preset) and/or the user profile (profile); both are asked for separately.
// Writes nothing when an answer looks like a secret; throws (nothing written) when the existing profile is unreadable or would become invalid.
// -> { saved: true, preset, dir } | { saved: false, findings }
export function saveSetup({ env, kitRoot, answers, mode, projectRoot, kit, now = new Date(), preset: wantPreset = true, profile: wantProfile = true }) {
  const findings = secretFindings({ answers, kitRoot });
  if (findings.length > 0) return { saved: false, findings };
  const date = now.toISOString().slice(0, 10);

  let profileDoc = null;
  if (wantProfile) {
    directory(userDir(env));
    const known = Object.keys(schemas().schemas.get('user-profile.schema.json').properties.answers.properties);
    let profile = {};
    if (existingStat(profileFile(env))) {
      try {
        profile = parse(read(profileFile(env)))?.answers ?? {};
      } catch {
        throw new Error(`${profileFile(env)} cannot be read; fix or remove the file (it was left untouched)`);
      }
    }
    for (const k of known) if (Object.hasOwn(answers, k)) profile[k] = answers[k];
    profileDoc = { answers: profile };
    check('user-profile.yaml', 'user-profile.schema.json', profileDoc);
  }

  let name = null;
  let presetDoc = null;
  if (wantPreset) {
    directory(userDir(env));
    directory(presetsDir(env));
    name = `${date}-${slug(basename(projectRoot))}`;
    for (let n = 2; existingStat(presetFile(env, name)); n += 1) name = `${date}-${slug(basename(projectRoot))}-${n}`;
    presetDoc = { name, description: `Setup of ${basename(projectRoot)}.`, created: date, source: projectRoot, mode, answers };
    check(`presets/${name}.yaml`, 'preset.schema.json', presetDoc);
  }

  if (profileDoc) existingStat(profileFile(env));
  if (presetDoc) {
    existingStat(presetFile(env, name));
    existingStat(join(userDir(env), 'history.jsonl'));
  }
  directory(userDir(env), true);
  directory(presetsDir(env), true);
  if (profileDoc) write(profileFile(env), stringify(profileDoc));
  if (presetDoc) {
    for (let n = 2; ; n += 1) {
      try { write(presetFile(env, name), stringify(presetDoc), { exclusive: true }); break; } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        name = `${date}-${slug(basename(projectRoot))}-${n}`;
        presetDoc.name = name;
        check(`presets/${name}.yaml`, 'preset.schema.json', presetDoc);
      }
    }
    const history = join(userDir(env), 'history.jsonl');
    write(history, `${JSON.stringify({ path: projectRoot, date, kit, preset: name })}\n`, { append: true });
  }
  return { saved: true, preset: name, profile: Boolean(profileDoc), dir: userDir(env) };
}

// -> [{ name, description, created, mode }] sorted by name
export function listPresets(env) {
  directory(userDir(env));
  if (!directory(presetsDir(env))) return [];
  return readdirSync(presetsDir(env))
    .filter((f) => f.endsWith('.yaml') && PRESET_NAME.test(f.slice(0, -5)))
    .filter((f) => isRegularFile(join(presetsDir(env), f)))
    .sort()
    .map((f) => {
      let doc = {};
      try { doc = parse(read(join(presetsDir(env), f))) ?? {}; } catch (e) {
        if (!(e instanceof YamlError)) throw e;
      }
      return { name: f.slice(0, -5), description: doc.description ?? '', created: doc.created ?? '', mode: doc.mode ?? '' };
    });
}

function existingPreset(env, name) {
  if (!PRESET_NAME.test(name)) throw new Error(`"${name}" is not a preset name (lower-case letters, digits, hyphens)`);
  directory(userDir(env));
  directory(presetsDir(env));
  const file = presetFile(env, name);
  if (!existingStat(file)) throw new Error(`no preset "${name}" (yaw presets list shows them)`);
  return file;
}

export function readPreset(env, name) {
  return read(existingPreset(env, name));
}

// Reading preferences is not consent to save them again.
export function readUserProfile(env) {
  directory(userDir(env));
  const file = profileFile(env);
  if (!existingStat(file)) return null;
  const doc = parse(read(file));
  check('user-profile.yaml', 'user-profile.schema.json', doc);
  return doc;
}

// Optional defaults must never stop setup or expose invalid profile contents.
export function loadPreferences({ env, kitRoot }) {
  try {
    const answers = readUserProfile(env)?.answers ?? {};
    if (secretFindings({ answers, kitRoot }).length) throw new Error('unsafe profile');
    return { answers, hasDefaults: PERSONAL_PREFERENCES.some((id) => Object.hasOwn(answers, id)), warning: null };
  } catch {
    return { answers: {}, hasDefaults: false, warning: 'Saved personal settings are unreadable or invalid; using documented defaults. The saved file was left untouched.' };
  }
}

export function deletePreset(env, name) {
  rmSync(existingPreset(env, name));
}

// The dashboard's Global Settings: rename keeps the content and updates its `name`.
export function renamePreset(env, name, to) {
  const from = existingPreset(env, name);
  if (typeof to !== 'string' || !PRESET_NAME.test(to)) throw new Error('A preset name uses lower-case letters, digits and hyphens');
  const target = presetFile(env, to);
  if (existingStat(target)) throw new Error(`A preset named "${to}" already exists`);
  const doc = parse(read(from)) ?? {};
  doc.name = to;
  check(`presets/${to}.yaml`, 'preset.schema.json', doc);
  try { write(target, stringify(doc), { exclusive: true }); } catch (e) {
    if (e.code === 'EEXIST') throw new Error(`A preset named "${to}" already exists`);
    throw e;
  }
  rmSync(from);
  return to;
}

// The dashboard's Global Settings: edited answers are merged into the preset; other keys stay as they are.
export function writePresetAnswers(env, name, answers) {
  const file = existingPreset(env, name);
  const doc = parse(read(file)) ?? {};
  doc.answers = { ...doc.answers, ...answers };
  check(`presets/${name}.yaml`, 'preset.schema.json', doc);
  write(file, stringify(doc));
}

// Keys the user profile holds: the section-0 answers of its schema and any setting a project switched to personal (T-027).
function profileKey(k) {
  const answers = schemas().schemas.get('user-profile.schema.json').properties.answers;
  return Object.hasOwn(answers.properties, k) || Object.keys(answers.patternProperties ?? {}).some((re) => new RegExp(re).test(k));
}

// -> { before: text | null, after: text } for the given personal answers; nothing is written.
export function nextUserProfile(env, answers) {
  directory(userDir(env));
  const file = profileFile(env);
  const before = existingStat(file) ? read(file) : null;
  let profile = {};
  if (before !== null) {
    try { profile = parse(before)?.answers ?? {}; } catch { throw new Error(`${file} cannot be read; fix or remove the file (it was left untouched)`); }
  }
  for (const k of Object.keys(answers)) if (profileKey(k)) profile[k] = answers[k];
  const doc = { answers: profile };
  check('user-profile.yaml', 'user-profile.schema.json', doc);
  return { before, after: stringify(doc) };
}

// The personal answers of a project (T-027) go only to ~/.yaw/user-profile.yaml, merged into it; never into the
// repository. An unreadable or invalid profile, or a value that looks like a secret, is left untouched. The profile
// is YAW's own file: its schema and secret rules are those of the installed kit, whatever kit renders the project.
// -> { saved: boolean, warning: string | null }
export function savePersonalAnswers({ env, answers }) {
  if (!Object.keys(answers).length) return { saved: false, warning: null };
  const warning = (why) => ({ saved: false, warning: `Personal settings were not saved to ${profileFile(env)}: ${why}` });
  if (secretFindings({ answers, kitRoot: KIT_ROOT }).length) return warning('an answer looks like a secret.');
  try {
    // An invalid profile (unknown key, wrong value) is never repaired by overwriting it (ADR-0043).
    try { readUserProfile(env); } catch { return warning('the file is unreadable or invalid; fix or remove it (it was left untouched).'); }
    const { before, after } = nextUserProfile(env, answers);
    if (before !== after) writeUserProfile(env, after);
    return { saved: true, warning: null };
  } catch (e) {
    return warning(e.message);
  }
}

export function writeUserProfile(env, text) {
  directory(userDir(env), true);
  existingStat(profileFile(env));
  write(profileFile(env), text);
}

export function readUserData(env, name) {
  if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) throw new Error('Invalid user data name');
  const dir = userDataDir(env);
  directory(dir);
  const file = join(dir, name);
  return existingStat(file) ? JSON.parse(read(file)) : null;
}

export function writeUserData(env, name, value) {
  if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) throw new Error('Invalid user data name');
  const dir = userDataDir(env);
  directory(dir, true);
  const file = join(dir, name);
  existingStat(file);
  write(file, `${JSON.stringify(value)}\n`);
}

export function userDataDir(env) {
  const dir = env.YAW_HOME || userDir(env);
  if (!isAbsolute(dir) || /[\u0000-\u001f\u007f]/.test(dir)) throw new Error('YAW user data requires an absolute YAW_HOME / HOME');
  return dir;
}

// First confirmed Basic/All answers establish personal defaults, never project facts or tool choices.
// Exclusive linking publishes a complete private file without replacing concurrently saved defaults.
export function seedPersonalPreferences({ env, kitRoot, mode, answers, reviewed = [] }) {
  if (!['basic', 'pro'].includes(depthOf(mode))) return { saved: false };
  const preferences = loadPreferences({ env, kitRoot });
  if (preferences.hasDefaults || preferences.warning) return { saved: false };
  const chosen = Object.fromEntries(PERSONAL_PREFERENCES.filter((id) => reviewed.includes(id) && Object.hasOwn(answers, id)).map((id) => [id, answers[id]]));
  if (!Object.keys(chosen).length) return { saved: false };
  if (secretFindings({ answers: chosen, kitRoot }).length) throw new Error('Personal defaults were not saved: an answer looks like a secret.');
  const doc = { answers: chosen };
  check('user-profile.yaml', 'user-profile.schema.json', doc);
  const dir = userDir(env); directory(dir, true);
  const file = profileFile(env);
  if (existingStat(file)) {
    // A legacy profile may contain agent/tool choices but no personal preferences yet.
    const before = read(file), current = readUserProfile(env);
    if (PERSONAL_PREFERENCES.some((id) => Object.hasOwn(current.answers, id)) || read(file) !== before) return { saved: false };
    const merged = { answers: { ...current.answers, ...chosen } };
    check('user-profile.yaml', 'user-profile.schema.json', merged);
    write(file, stringify(merged));
    return { saved: true };
  }
  try { write(file, stringify(doc), { exclusive: true }); } catch (e) { if (e.code === 'EEXIST') return { saved: false }; throw e; }
  return { saved: true };
}
