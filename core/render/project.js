// Project operations behind `yaw init`, `yaw update`, `yaw remove` and `yaw status`.
// All of them render the enabled modules and hand the result to reconcile() (ADR-0003).

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument } from '../lib/yaml.js';
import { matchFacts } from '../interview/facts.js';
import { formatError } from '../lib/schema.js';
import { BASE_DIR, MANIFEST, hashContent, pruneEmptyDirs, readProjectFile, writeAtomic } from './files.js';
import { compareVersions, hasModule, kitVersion, loadModule, renderModules, renderProfiles, schemas, templateContext, KIT_ROOT } from './kit.js';
import { deleteManifest, readManifest, writeManifest } from './manifest.js';
import { hasConflictMarkers, reconcile } from './reconcile.js';

export const ANSWERS = '.yaw/answers.yaml';

export class ProjectError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProjectError';
  }
}

export function parseAnswers(text, file = ANSWERS) {
  const { value, lines } = parseDocument(text, { file });
  const errors = schemas().validate('answers.schema.json', value, { lines });
  if (errors.length > 0) throw new ProjectError(errors.map((e) => formatError(e, file)).join('\n'));
  return value;
}

export function readAnswers(root) {
  const buf = readProjectFile(root, ANSWERS);
  if (buf === null) throw new ProjectError(`${ANSWERS} is missing`);
  return parseAnswers(buf.toString('utf8'));
}

export function requireManifest(root) {
  const manifest = readManifest(root);
  if (!manifest) throw new ProjectError(`no ${MANIFEST} here; run yaw init first`);
  return manifest;
}

function checkKitNotOlder(manifest, kitRoot) {
  const version = kitVersion(kitRoot);
  if (compareVersions(version, manifest.kit) < 0) {
    throw new ProjectError(`this project was written by kit ${manifest.kit}, the installed kit is ${version}: run yaw self-update first`);
  }
}

// Render `modules` and reconcile the project with the result; writes files, bases and the manifest.
// Used by update (same modules), remove (one fewer) and, later, add (one more).
export async function applyModules({ root, kitRoot = KIT_ROOT, modules, mode = 'update', removing, ...options }) {
  const manifest = requireManifest(root);
  checkKitNotOlder(manifest, kitRoot);
  const { desired, missing, profileOutput } = renderProject({ root, kitRoot, manifest, modules });
  const version = kitVersion(kitRoot);
  const result = await reconcile(root, manifest.files, desired, { ...options, mode, removing, label: `kit ${version}` });

  const nextModules = {};
  for (const m of modules) nextModules[m] = manifest.modules[m] ?? { enabled: true };
  for (const [m, entry] of Object.entries(manifest.modules)) if (!entry.enabled && m !== removing) nextModules[m] = entry;

  if (modules.length === 0) {
    deleteManifest(root);
    pruneEmptyDirs(root, BASE_DIR);
    return { ...result, manifest: null, missingModules: missing, missingProfiles: [] };
  }
  const written = writeManifest(root, { ...manifest, kit: version, modules: nextModules, files: result.files });
  return { ...result, manifest: written, missingModules: missing, missingProfiles: profileOutput?.missing ?? [] };
}

// Render `modules` for an existing project from the installed kit and its answers; writes nothing.
// -> { desired, missing (modules not in the kit), profileOutput }
export function renderProject({ root, kitRoot = KIT_ROOT, manifest, modules }) {
  const answersDoc = readAnswers(root);
  const available = modules.filter((m) => hasModule(kitRoot, m));
  const missing = modules.filter((m) => !available.includes(m));
  const definitions = new Map(available.map((m) => [m, loadModule(kitRoot, m)]));
  const context = templateContext({ kitRoot, answersDoc, modules: available, definitions });
  // Profile files belong to core: they go away with it (the scaffold is user code and stays).
  const profileOutput = available.length > 0 ? renderProfiles({ kitRoot, profiles: manifest.profiles }) : undefined;
  const desired = renderModules({ kitRoot, modules: available, context, definitions, profileOutput });
  return { desired, missing, profileOutput };
}

export function enabledModules(manifest) {
  return Object.entries(manifest.modules).filter(([, e]) => e.enabled).map(([m]) => m);
}

export function updateProject({ root, kitRoot = KIT_ROOT, ...options }) {
  const manifest = requireManifest(root);
  for (const [flag, paths] of [['--restore', options.restore], ['--forget', options.forget]]) {
    for (const p of paths ?? []) {
      const f = manifest.files.find((x) => x.path === p);
      if (!f || !f.managed) throw new ProjectError(`${flag} ${p}: not a managed file in the manifest`);
      if (readProjectFile(root, p) !== null) throw new ProjectError(`${flag} ${p}: the file exists; ${flag} is only for missing files`);
    }
  }
  return applyModules({ root, kitRoot, modules: enabledModules(manifest), mode: 'update', ...options });
}

// Choose the modules a mode starts with: every module the kit has whose default for the mode is true or
// whose facts condition matches (doc 04 §1). `appliesTo` hides a module whose facts do not match.
export function selectModules({ kitRoot = KIT_ROOT, mode, facts = {} }) {
  const dir = join(kitRoot, 'modules');
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => hasModule(kitRoot, n)).sort() : [];
  const chosen = [];
  for (const name of names) {
    const def = loadModule(kitRoot, name);
    if (def.appliesTo && matchFacts(def.appliesTo, facts).mismatched > 0) continue;
    const d = def.default[mode];
    if (d === true || (d && typeof d === 'object' && matchFacts(d, facts).mismatched === 0 && matchFacts(d, facts).matched > 0)) chosen.push(name);
  }
  // core first: it owns the shared files
  return chosen.includes('core') ? ['core', ...chosen.filter((n) => n !== 'core')] : chosen;
}

// Render what `yaw init` would write, without writing anything.
// -> { desired: Map<path, { module, content, fragments, managed? }>, definitions, missingProfiles }
export function renderInit({ root, kitRoot = KIT_ROOT, answersDoc, modules }) {
  for (const m of modules) if (!hasModule(kitRoot, m)) throw new ProjectError(`module "${m}" does not exist in this kit`);
  const profiles = answersDoc.proposal.profiles;
  if (profiles.length > 1) throw new ProjectError(`several profiles (${profiles.join(', ')}) come with composition (Y-6.8); choose one`);
  const definitions = new Map(modules.map((m) => [m, loadModule(kitRoot, m)]));
  const context = templateContext({ kitRoot, answersDoc, modules, definitions });
  const profileOutput = renderProfiles({ kitRoot, profiles, scaffold: (rel) => readProjectFile(root, rel) !== null });
  const desired = renderModules({ kitRoot, modules, context, definitions, profileOutput });
  return { desired, definitions, missingProfiles: profileOutput.missing };
}

// `yaw init`: render, then write files, bases and the manifest. The answers come from a file
// (`answersFile`, copied byte for byte, ADR-0019) or from the interview (`answers: { text, doc }`).
export async function initProject({ root, kitRoot = KIT_ROOT, answersFile, answers, modules = ['core'], ...options }) {
  if (readManifest(root)) throw new ProjectError(`${MANIFEST} already exists; use yaw update`);
  let text;
  let answersDoc;
  let sameFile = false;
  if (answers) {
    ({ text, doc: answersDoc } = answers);
  } else {
    const source = resolve(answersFile);
    try {
      text = readFileSync(source);
    } catch (e) {
      throw new ProjectError(`cannot read ${answersFile}: ${e.code ?? e.message}`);
    }
    answersDoc = parseAnswers(text.toString('utf8'), answersFile);
    const target = resolve(root, ANSWERS);
    sameFile = existsSync(target) && realpathSync(target) === realpathSync(source);
    if (!sameFile && existsSync(target)) throw new ProjectError(`${ANSWERS} already exists; pass it with --answers ${ANSWERS}`);
  }
  const agents = answersDoc.answers['user.agents'];
  const label = answersFile ?? 'the answers';
  if (!agents) throw new ProjectError(`${label}: answers need user.agents`);
  if (!answersDoc.proposal?.profiles) throw new ProjectError(`${label}: answers need proposal.profiles`);

  // Render first: a template error must not leave files behind.
  const { desired, missingProfiles } = renderInit({ root, kitRoot, answersDoc, modules });
  const version = kitVersion(kitRoot);

  if (!sameFile) writeAtomic(root, ANSWERS, text);
  const answersEntry = { path: ANSWERS, module: 'core', hash: hashContent(text), managed: false };
  const result = await reconcile(root, [], desired, { ...options, mode: 'init', label: `kit ${version}` });
  const manifest = writeManifest(root, {
    kit: version,
    profiles: answersDoc.proposal.profiles,
    preset: answersDoc.mode,
    agents,
    vendored: false,
    modules: Object.fromEntries(modules.map((m) => [m, { enabled: true }])),
    mcpServers: [],
    files: [...result.files, answersEntry],
  });
  return { ...result, manifest, missingProfiles };
}

// What `yaw remove <module>` would do; refuses when other modules depend on it.
export function planRemove({ root, kitRoot = KIT_ROOT, module }) {
  const manifest = requireManifest(root);
  const enabled = enabledModules(manifest);
  if (!enabled.includes(module)) throw new ProjectError(`module "${module}" is not installed`);
  const others = enabled.filter((m) => m !== module);
  if (module === 'core' && others.length > 0) {
    throw new ProjectError(`core is removed last; remove ${others.join(', ')} first`);
  }
  const dependents = others.filter((m) => hasModule(kitRoot, m) && (loadModule(kitRoot, m).depends ?? []).includes(module));
  if (dependents.length > 0) throw new ProjectError(`${dependents.join(', ')} depend${dependents.length === 1 ? 's' : ''} on ${module}; remove ${dependents.length === 1 ? 'it' : 'them'} first`);
  const files = manifest.files.filter((f) => f.module === module);
  const fragments = manifest.files.filter((f) => f.module !== module && (f.fragments ?? []).some((x) => x.module === module));
  return { manifest, remaining: others, files, fragments };
}

export async function removeModule({ root, kitRoot = KIT_ROOT, module, ...options }) {
  const plan = planRemove({ root, kitRoot, module });
  return applyModules({ root, kitRoot, modules: plan.remaining, mode: 'remove', removing: module, ...options });
}

// Per-file state for `yaw status` and `yaw doctor`.
export function fileStates(root, manifest) {
  return manifest.files.map((f) => {
    const current = readProjectFile(root, f.path);
    let state;
    if (current === null) state = 'missing';
    else if (!f.managed) state = 'owned';
    else if (hasConflictMarkers(current) && hashContent(current) !== f.hash) state = 'conflict';
    else if (hashContent(current) !== f.hash) state = 'edited';
    else state = 'unedited';
    return { ...f, state };
  });
}
