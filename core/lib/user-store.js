// The user folder ~/.yaw/ (Y-7.2, ADR-0043, doc 02 §5): user profile, saved setups ("presets"), history.jsonl.
// Created only after the user opted in; files 0600, folders 0700; answers only, never secrets (doc 08).

import { closeSync, constants, fchmodSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { parse, stringify, YamlError } from './yaml.js';
import { formatError } from './schema.js';
import { schemas } from '../render/kit.js';
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

function write(path, text, { append = false } = {}) {
  let fd;
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK |
    (append ? constants.O_APPEND : 0);
  try {
    fd = openSync(path, flags, 0o600);
    if (!fstatSync(fd).isFile()) throw new Error(`${path} must be a regular file`);
    fchmodSync(fd, 0o600);
    if (!append) ftruncateSync(fd, 0);
    writeFileSync(fd, text);
  } finally {
    if (fd !== undefined) closeSync(fd);
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
    write(presetFile(env, name), stringify(presetDoc));
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
  write(target, stringify(doc));
  rmSync(from);
  return to;
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
  const known = Object.keys(schemas().schemas.get('user-profile.schema.json').properties.answers.properties);
  for (const k of known) if (Object.hasOwn(answers, k)) profile[k] = answers[k];
  const doc = { answers: profile };
  check('user-profile.yaml', 'user-profile.schema.json', doc);
  return { before, after: stringify(doc) };
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
  const file = join(dir, name), temp = `${file}.${randomUUID()}.tmp`;
  existingStat(file);
  try {
    write(temp, `${JSON.stringify(value)}\n`);
    renameSync(temp, file);
  } finally { rmSync(temp, { force: true }); }
}

export function userDataDir(env) {
  const dir = env.YAW_HOME || userDir(env);
  if (!isAbsolute(dir) || /[\u0000-\u001f\u007f]/.test(dir)) throw new Error('YAW user data requires an absolute YAW_HOME / HOME');
  return dir;
}
