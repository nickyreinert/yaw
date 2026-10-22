// The user folder ~/.yaw/ (Y-7.2, ADR-0043, doc 02 §5): user profile, saved setups ("presets"), history.jsonl.
// Created only after the user opted in; files 0600, folders 0700; answers only, never secrets (doc 08).

import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { parse, stringify } from './yaml.js';
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

function dir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

function write(path, text) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
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
    const known = Object.keys(schemas().schemas.get('user-profile.schema.json').properties.answers.properties);
    let profile = {};
    if (existsSync(profileFile(env))) {
      try {
        profile = parse(readFileSync(profileFile(env), 'utf8'))?.answers ?? {};
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
    name = `${date}-${slug(basename(projectRoot))}`;
    for (let n = 2; existsSync(presetFile(env, name)); n += 1) name = `${date}-${slug(basename(projectRoot))}-${n}`;
    presetDoc = { name, description: `Setup of ${basename(projectRoot)}.`, created: date, source: projectRoot, mode, answers };
    check(`presets/${name}.yaml`, 'preset.schema.json', presetDoc);
  }

  dir(userDir(env));
  dir(presetsDir(env));
  if (profileDoc) write(profileFile(env), stringify(profileDoc));
  if (presetDoc) {
    write(presetFile(env, name), stringify(presetDoc));
    const history = join(userDir(env), 'history.jsonl');
    appendFileSync(history, `${JSON.stringify({ path: projectRoot, date, kit, preset: name })}\n`, { mode: 0o600 });
    chmodSync(history, 0o600);
  }
  return { saved: true, preset: name, profile: Boolean(profileDoc), dir: userDir(env) };
}

// -> [{ name, description, created, mode }] sorted by name
export function listPresets(env) {
  if (!existsSync(presetsDir(env))) return [];
  return readdirSync(presetsDir(env))
    .filter((f) => f.endsWith('.yaml') && PRESET_NAME.test(f.slice(0, -5)))
    .sort()
    .map((f) => {
      let doc = {};
      try {
        doc = parse(readFileSync(join(presetsDir(env), f), 'utf8')) ?? {};
      } catch {
        doc = {};
      }
      return { name: f.slice(0, -5), description: doc.description ?? '', created: doc.created ?? '', mode: doc.mode ?? '' };
    });
}

function existingPreset(env, name) {
  if (!PRESET_NAME.test(name)) throw new Error(`"${name}" is not a preset name (lower-case letters, digits, hyphens)`);
  const file = presetFile(env, name);
  if (!existsSync(file)) throw new Error(`no preset "${name}" (yaw presets list shows them)`);
  return file;
}

export function readPreset(env, name) {
  return readFileSync(existingPreset(env, name), 'utf8');
}

export function deletePreset(env, name) {
  rmSync(existingPreset(env, name));
}
