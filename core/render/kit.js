// Kit access for the render engine: version, module definitions, rendering module outputs.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../lib/yaml.js';
import { tasksMode } from '../lib/tasks.js';
import { formatError } from '../lib/schema.js';
import { loadSchemas } from '../schema/validate.js';
import { render } from './template.js';
import { AGENTS_MAX_LINES, compose, SHARED_FILES } from './compose.js';
import { checkRelPath } from './files.js';
import { HOOK_SHIM, hookParts, pathWanted, shimContent, skillFiles } from './agents.js';

export const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let cachedSchemas;
export function schemas() {
  cachedSchemas ??= loadSchemas();
  return cachedSchemas;
}

export class KitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KitError';
  }
}

export function kitVersion(kitRoot = KIT_ROOT) {
  return JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8')).version;
}

// Compare x.y.z[-pre] versions; a pre-release sorts before its release. Returns -1, 0 or 1.
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = null] = String(v).replace(/^v/, '').split(/-(.*)/s);
    return { nums: core.split('.').map(Number), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) < (y.nums[i] ?? 0) ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export function moduleDir(kitRoot, name) {
  return join(kitRoot, 'modules', name);
}

export function hasModule(kitRoot, name) {
  return /^[a-z][a-z0-9-]*$/.test(name) && existsSync(join(moduleDir(kitRoot, name), 'module.yaml'));
}

// Read and validate modules/<name>/module.yaml.
export function loadModule(kitRoot, name) {
  if (!hasModule(kitRoot, name)) throw new KitError(`module "${name}" does not exist in this kit`);
  const file = join(moduleDir(kitRoot, name), 'module.yaml');
  const { value, lines } = parseDocument(readFileSync(file, 'utf8'), { file });
  const errors = schemas().validate('module.schema.json', value, { lines });
  if (errors.length > 0) throw new KitError(errors.map((e) => formatError(e, file)).join('\n'));
  if (value.name !== name) throw new KitError(`${file}: name "${value.name}" does not match its folder "${name}"`);
  return value;
}

export function profileDir(kitRoot, name) {
  return join(kitRoot, 'profiles', name);
}

export function hasProfile(kitRoot, name) {
  return /^[a-z][a-z0-9-]*$/.test(name) && existsSync(join(profileDir(kitRoot, name), 'profile.yaml'));
}

// Read and validate profiles/<name>/profile.yaml.
export function loadProfile(kitRoot, name) {
  if (!hasProfile(kitRoot, name)) throw new KitError(`profile "${name}" does not exist in this kit`);
  const file = join(profileDir(kitRoot, name), 'profile.yaml');
  const { value, lines } = parseDocument(readFileSync(file, 'utf8'), { file });
  const errors = schemas().validate('profile.schema.json', value, { lines });
  if (errors.length > 0) throw new KitError(errors.map((e) => formatError(e, file)).join('\n'));
  if (value.name !== name) throw new KitError(`${file}: name "${value.name}" does not match its folder "${name}"`);
  return value;
}

export function listProfiles(kitRoot) {
  const dir = join(kitRoot, 'profiles');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => hasProfile(kitRoot, n)).sort().map((n) => loadProfile(kitRoot, n));
}

// interview/base.yaml: the questions every setup asks (doc 02 §3).
export function loadBaseQuestions(kitRoot) {
  const file = join(kitRoot, 'interview', 'base.yaml');
  if (!existsSync(file)) return [];
  const { value, lines } = parseDocument(readFileSync(file, 'utf8'), { file });
  const errors = schemas().validate('questions.schema.json', value, { lines });
  if (errors.length > 0) throw new KitError(errors.map((e) => formatError(e, file)).join('\n'));
  return value.questions;
}

// Base questions plus the inline questions of the given modules; ids are unique across the kit (ADR-0017).
export function collectQuestions(kitRoot, modules, definitions) {
  const all = [...loadBaseQuestions(kitRoot)];
  for (const m of modules) all.push(...((definitions?.get(m) ?? loadModule(kitRoot, m)).questions ?? []));
  const seen = new Set();
  for (const q of all) {
    if (seen.has(q.id)) throw new KitError(`question id "${q.id}" is defined twice`);
    seen.add(q.id);
  }
  return all;
}

const AUTONOMY = {
  'ask-often': 'Ask before every change that is not trivial.',
  'ask-risky': 'Ask before risky or ambiguous steps; otherwise act.',
  'act-and-report': 'Act, then report what you did and why.',
};

// Communication style lines, rendered from the user profile (answers user.length ... user.expertise).
const STYLE = {
  length: {
    brief: 'Keep answers short and to the point.',
    balanced: 'Give balanced answers: the result first, then the reasoning that matters.',
    extensive: 'Give thorough answers with full detail.',
  },
  register: {
    plain: 'Use plain words; avoid jargon.',
    professional: 'Use a professional tone.',
    technical: 'Use precise technical terms.',
    scientific: 'Use scientific precision and name the basis for claims.',
  },
  examples: {
    'when-helpful': 'Use examples or analogies when they help.',
    always: 'Illustrate every explanation with an example or analogy.',
    never: 'Do not use examples or analogies unless asked.',
  },
  explain: {
    'one-line': 'Explain why you chose something in one line.',
    'short-paragraph': 'Explain why you chose something in a short paragraph.',
    'on-request': 'Explain your reasoning only when asked.',
  },
  expertise: {
    layperson: 'The user is new to software development: explain terms and steps.',
    intermediate: 'The user has intermediate development experience.',
    expert: 'The user is an expert: skip the basics.',
  },
};
const STYLE_DEFAULTS = { length: 'balanced', register: 'professional' };

// ADR-0024: the stack overlay of the standards module (profiles/<p>/standards.md) has at most 20 lines.
export const OVERLAY_MAX_LINES = 20;

export function profileOverlay(kitRoot, profiles) {
  const parts = [];
  for (const p of profiles) {
    const file = join(profileDir(kitRoot, p), 'standards.md');
    if (!hasProfile(kitRoot, p) || !existsSync(file)) continue;
    const text = readFileSync(file, 'utf8').trim();
    const lines = text === '' ? 0 : text.split('\n').length;
    if (lines > OVERLAY_MAX_LINES) throw new KitError(`${file}: ${lines} lines, the overlay is limited to ${OVERLAY_MAX_LINES}`);
    if (text !== '') parts.push(text);
  }
  return parts.join('\n');
}

// ADR-0025: files a profile ships for the devenv module. env.example (variable names, comments) is joined over
// all profiles; the container files are profiles/<p>/devenv/{Dockerfile,compose.yaml,devcontainer.json} and
// a file that two profiles ship is an error (a container setup cannot be concatenated).
export const DEVENV_FILES = { dockerfile: 'Dockerfile', compose: 'compose.yaml', devcontainer: 'devcontainer.json' };

export function profileDevenv(kitRoot, profiles) {
  const out = { env: '', dockerfile: '', compose: '', devcontainer: '' };
  const env = [];
  const from = {};
  for (const p of profiles) {
    if (!hasProfile(kitRoot, p)) continue;
    const dir = profileDir(kitRoot, p);
    const envFile = join(dir, 'env.example');
    if (existsSync(envFile)) {
      const text = readFileSync(envFile, 'utf8').trim();
      if (text !== '') env.push(text);
    }
    for (const [key, name] of Object.entries(DEVENV_FILES)) {
      const file = join(dir, 'devenv', name);
      if (!existsSync(file)) continue;
      if (from[key]) throw new KitError(`profiles "${from[key]}" and "${p}" both ship devenv/${name}; keep one of them`);
      from[key] = p;
      out[key] = readFileSync(file, 'utf8').trim();
    }
  }
  out.env = env.join('\n\n');
  return out;
}

// ADR-0027: the toolchain steps of the profiles' ci/check.yml fragments for the ci module's workflow.
// The workflow itself supplies checkout, the kit install, `just setup` and `just check`, so those are
// dropped from the fragments; identical steps of several profiles are kept once. Steps are kept as
// text so the pin comments (`# v4.4.0`) survive. -> { steps: text for the workflow, needsNode: boolean }
export function profileCi(kitRoot, profiles) {
  const blocks = [];
  let needsNode = true;
  for (const p of profiles) {
    const file = join(profileDir(kitRoot, p), 'ci', 'check.yml');
    if (!hasProfile(kitRoot, p) || !existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const doc = parseDocument(text, { file: `profiles/${p}/ci/check.yml` }).value;
    if (!Array.isArray(doc?.steps) || doc.steps.some((s) => s === null || typeof s !== 'object' || Array.isArray(s))) {
      throw new KitError(`profiles/${p}/ci/check.yml: "steps" must be a list of steps`);
    }
    const lines = text.split('\n');
    const at = lines.findIndex((l) => /^steps:\s*$/.test(l));
    let current = null;
    for (const line of lines.slice(at + 1)) {
      if (/^ {2}- /.test(line)) {
        current = [line.slice(2)];
        blocks.push(current);
      } else if (current && (/^ {4}/.test(line) || line.trim() === '')) {
        current.push(line.startsWith('  ') ? line.slice(2) : line);
      } else if (!/^\s*(#.*)?$/.test(line)) {
        throw new KitError(`profiles/${p}/ci/check.yml: cannot read the step "${line.trim()}"; use the "  - key: value" layout`);
      }
    }
  }
  const kept = [];
  const seen = new Set();
  for (const block of blocks) {
    while (block.length > 0 && block[block.length - 1].trim() === '') block.pop();
    const head = block[0].replace(/\s+#.*$/, '').trim();
    if (/^- uses: actions\/checkout@/.test(head) || /^- run: just (setup|check)$/.test(head)) continue;
    const text = block.join('\n');
    if (seen.has(text)) continue;
    seen.add(text);
    if (/^- uses: actions\/setup-node@/.test(head)) needsNode = false;
    kept.push(text);
  }
  return { steps: kept.join('\n').replace(/\n/g, '\n      '), needsNode };
}

// One line of free text that is safe inside AGENTS.md (no markers, no line breaks).
function oneLine(text) {
  return String(text ?? '').replace(/<!--|-->/g, ' ').replace(/\s+/g, ' ').trim();
}

function taskFlags(mode) {
  return { mode, local: mode === 'local', github: mode === 'github', both: mode === 'both', source: mode !== 'github' };
}

// Context for templates (ADR-0002): computed in JS, templates only read it.
// Answers are nested by question group: "idea.text" is answers.idea.text. Questions the user did not
// answer take their default, so a template never sees a missing answer.
export function templateContext({ kitRoot, answersDoc, modules, definitions }) {
  const flat = {};
  for (const q of collectQuestions(kitRoot, modules, definitions)) flat[q.id] = q.default;
  Object.assign(flat, answersDoc.answers ?? {});
  const answers = {};
  for (const [id, value] of Object.entries(flat)) {
    const [group, name] = id.split('.');
    answers[group] ??= {};
    answers[group][name] = value;
  }
  const profiles = answersDoc.proposal?.profiles ?? [];
  const stack = profiles.map((p) => (hasProfile(kitRoot, p) ? `${p} - ${loadProfile(kitRoot, p).summary}` : p)).join('; ');
  return {
    kit: { version: kitVersion(kitRoot) },
    mode: answersDoc.mode,
    answers,
    proposal: answersDoc.proposal ?? null,
    agents: flat['user.agents'] ?? [],
    profiles,
    modules: [...modules],
    ideaLine: oneLine(flat['idea.text']),
    stack,
    rules: {
      autonomy: AUTONOMY[flat['user.autonomy']] ?? '',
      length: STYLE.length[flat['user.length']] ?? '',
      register: STYLE.register[flat['user.register']] ?? '',
      examples: STYLE.examples[flat['user.examples']] ?? '',
      explain: STYLE.explain[flat['user.explain']] ?? '',
      expertise: STYLE.expertise[flat['user.expertise']] ?? '',
    },
    // ADR-0013: the user profile is personal; a team repository does not commit it.
    team: (flat['idea.team'] ?? 'solo') !== 'solo',
    // Output style: Claude only, and only when length or register differ from the default (doc 04).
    outputStyle: (flat['user.agents'] ?? []).includes('claude')
      && ((flat['user.length'] ?? STYLE_DEFAULTS.length) !== STYLE_DEFAULTS.length
        || (flat['user.register'] ?? STYLE_DEFAULTS.register) !== STYLE_DEFAULTS.register),
    profileStandards: profileOverlay(kitRoot, profiles),
    devenv: profileDevenv(kitRoot, profiles),
    // ADR-0027: toolchain steps for the ci module.
    ci: profileCi(kitRoot, profiles),
    // ADR-0010: the effective task mode (team forces github) as booleans, since templates have no comparisons.
    tasks: taskFlags(tasksMode(flat)),
  };
}

// Files of the given profiles (ADR-0004: owned by core; profiles are not modules).
//   just/<p>.just   <- profiles/<p>/just/<p>.just          (plus `import` in the justfile)
//   .gitignore part <- profiles/<p>/gitignore
//   scaffold        <- profiles/<p>/scaffold/**            (user-owned code, written once; `scaffold` is a
//                      function rel -> boolean (file exists); one existing file skips the whole scaffold)
// standards.md, guards.yaml and ci/check.yml are read by the modules that need them (standards, security, ci).
// Profiles missing from the kit are reported, not rendered.
// -> { parts: [{ path, module, kind, content }], files: Map<path, { module, content, fragments, managed }>, missing }
export function renderProfiles({ kitRoot, profiles, scaffold = null }) {
  const parts = [];
  const files = new Map();
  const missing = [];
  for (const name of profiles) {
    if (!hasProfile(kitRoot, name)) {
      missing.push(name);
      continue;
    }
    const dir = profileDir(kitRoot, name);
    const justFile = join(dir, 'just', `${name}.just`);
    if (existsSync(justFile)) {
      files.set(`just/${name}.just`, { module: 'core', content: readFileSync(justFile), fragments: [], managed: true });
      parts.push({ path: 'justfile', module: name, kind: 'part', content: `import 'just/${name}.just'\n` });
    }
    const ignore = join(dir, 'gitignore');
    if (existsSync(ignore)) parts.push({ path: '.gitignore', module: name, kind: 'part', content: readFileSync(ignore) });
    if (scaffold) {
      const rels = walk(join(dir, 'scaffold'));
      if (!rels.some((rel) => scaffold(rel))) {
        for (const rel of rels) {
          checkRelPath(rel);
          if (files.has(rel)) throw new KitError(`profiles write ${rel} twice`);
          files.set(rel, { module: 'core', content: readFileSync(join(dir, 'scaffold', rel)), fragments: [], managed: false });
        }
      }
    }
  }
  return { parts, files, missing };
}

function walk(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(dir, name)).isDirectory()) out.push(...walk(join(dir, name), rel));
    else out.push(rel);
  }
  return out;
}

// Render the outputs of the given modules (and of the profile output from renderProfiles).
// -> Map<path, { module, content: Buffer, fragments: [{ module, hash }], managed? }>
export function renderModules({ kitRoot, modules, context, definitions, profileOutput }) {
  const owned = new Map();
  const shared = new Map();
  const addPart = (path, part) => {
    if (!shared.has(path)) shared.set(path, []);
    shared.get(path).push(part);
  };
  const agents = context.agents ?? [];
  const defs = new Map(modules.map((name) => [name, definitions?.get(name) ?? loadModule(kitRoot, name)]));
  const addOwned = (path, file) => {
    if (owned.has(path)) throw new KitError(`${path} is written by modules "${owned.get(path).module}" and "${file.module}" but is not a shared file`);
    owned.set(path, file);
  };
  for (const name of modules) {
    const def = defs.get(name);
    const dir = join(moduleDir(kitRoot, name), 'templates');
    for (const path of def.outputs?.templates ?? []) {
      checkRelPath(path);
      // agent-specific files only for the selected agents (.claude/, .codex/; ADR-0021)
      if (!pathWanted(path, agents)) continue;
      const tmpl = join(dir, `${path}.tmpl`);
      const plain = join(dir, path);
      const hasTmpl = existsSync(tmpl);
      const hasPlain = existsSync(plain);
      if (hasTmpl && hasPlain) throw new KitError(`module "${name}": both ${path} and ${path}.tmpl exist`);
      if (!hasTmpl && !hasPlain) throw new KitError(`module "${name}": template ${path} not found`);
      const content = hasTmpl
        ? Buffer.from(render(readFileSync(tmpl, 'utf8'), context, { file: `modules/${name}/templates/${path}.tmpl` }), 'utf8')
        : readFileSync(plain);
      // ADR-0024: a template that renders to nothing but whitespace produces no file and no part.
      if (hasTmpl && content.toString('utf8').trim() === '') continue;
      if (SHARED_FILES[path]) {
        addPart(path, { module: name, kind: 'template', content });
      } else if (owned.has(path)) {
        throw new KitError(`${path} is written by modules "${owned.get(path).module}" and "${name}" but is not a shared file`);
      } else {
        owned.set(path, { module: name, content, fragments: [] });
      }
    }
    if (def.agentsMd) addPart('AGENTS.md', { module: name, kind: 'agentsMd', content: def.agentsMd });
    // skills: .agents/skills/ + the Claude copy (ADR-0012)
    for (const [path, content] of skillFiles({ moduleDir: moduleDir(kitRoot, name), def, agents })) addOwned(path, { module: name, content, fragments: [] });
  }
  // hook registrations in the agents' settings files, and the shim they call (ADR-0006, ADR-0021)
  const hooks = hookParts({ definitions: defs, modules, agents });
  for (const part of hooks) addPart(part.path, { module: part.module, kind: part.kind, content: part.content });
  if (hooks.length > 0 && modules.includes('core')) addOwned(HOOK_SHIM, { module: 'core', content: shimContent(), fragments: [] });
  for (const part of profileOutput?.parts ?? []) {
    if (!SHARED_FILES[part.path]) throw new KitError(`${part.path} is not a shared file`);
    addPart(part.path, { module: part.module, kind: part.kind, content: part.content });
  }
  for (const [path, file] of profileOutput?.files ?? []) {
    if (owned.has(path) || shared.has(path)) throw new KitError(`${path} is written by a profile and by "${owned.get(path)?.module ?? 'a module'}"`);
    owned.set(path, file);
  }
  for (const [path, parts] of shared) {
    const spec = SHARED_FILES[path];
    const { content, fragments } = compose(path, spec, parts);
    if (content === null) continue;
    if (path === 'AGENTS.md') checkAgentsBudget(content, parts);
    owned.set(path, { module: spec.owner, content: Buffer.from(content, 'utf8'), fragments });
  }
  return owned;
}

// M16: AGENTS.md has a hard line budget in every mode (ADR-0009); the error names the contributors.
function checkAgentsBudget(content, parts) {
  const lines = content.replace(/\n$/, '').split('\n').length;
  if (lines <= AGENTS_MAX_LINES) return;
  const count = (text) => String(text).replace(/\n$/, '').split('\n').length;
  const per = parts.map((p) => `${p.module} ${p.kind === 'agentsMd' ? 'rules' : 'frame'} ${count(p.content)}`).join(', ');
  throw new KitError(`AGENTS.md would have ${lines} lines, the budget is ${AGENTS_MAX_LINES} (${per}); shorten a module's agentsMd or move detail into docs/spec/`);
}
