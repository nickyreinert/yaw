// Project operations behind `yaw init`, `yaw update`, `yaw remove` and `yaw status`.
// All of them render the enabled modules and hand the result to reconcile() (ADR-0003).

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument } from '../lib/yaml.js';
import { formatError } from '../lib/schema.js';
import { BASE_DIR, MANIFEST, hashContent, pruneEmptyDirs, readProjectFile, writeAtomic } from './files.js';
import { compareVersions, hasModule, kitVersion, loadModule, renderModules, schemas, templateContext, KIT_ROOT } from './kit.js';
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
  const answersDoc = readAnswers(root);
  const available = modules.filter((m) => hasModule(kitRoot, m));
  const missing = modules.filter((m) => !available.includes(m));
  const definitions = new Map(available.map((m) => [m, loadModule(kitRoot, m)]));
  const context = templateContext({ kitRoot, answersDoc, modules: available });
  const desired = renderModules({ kitRoot, modules: available, context, definitions });
  const version = kitVersion(kitRoot);
  const result = await reconcile(root, manifest.files, desired, { ...options, mode, removing, label: `kit ${version}` });

  const nextModules = {};
  for (const m of modules) nextModules[m] = manifest.modules[m] ?? { enabled: true };
  for (const [m, entry] of Object.entries(manifest.modules)) if (!entry.enabled && m !== removing) nextModules[m] = entry;

  if (modules.length === 0) {
    deleteManifest(root);
    pruneEmptyDirs(root, BASE_DIR);
    return { ...result, manifest: null, missingModules: missing };
  }
  const written = writeManifest(root, { ...manifest, kit: version, modules: nextModules, files: result.files });
  return { ...result, manifest: written, missingModules: missing };
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

// `yaw init --answers <file> --yes` (Y-2.10): core only, no interview.
export async function initProject({ root, kitRoot = KIT_ROOT, answersFile, modules = ['core'], ...options }) {
  if (readManifest(root)) throw new ProjectError(`${MANIFEST} already exists; use yaw update`);
  const source = resolve(answersFile);
  let text;
  try {
    text = readFileSync(source);
  } catch (e) {
    throw new ProjectError(`cannot read ${answersFile}: ${e.code ?? e.message}`);
  }
  const answersDoc = parseAnswers(text.toString('utf8'), answersFile);
  const agents = answersDoc.answers['user.agents'];
  if (!agents) throw new ProjectError(`${answersFile}: answers need user.agents`);
  if (!answersDoc.proposal?.profiles) throw new ProjectError(`${answersFile}: answers need proposal.profiles`);

  const target = resolve(root, ANSWERS);
  const sameFile = existsSync(target) && realpathSync(target) === realpathSync(source);
  if (!sameFile && existsSync(target)) throw new ProjectError(`${ANSWERS} already exists; pass it with --answers ${ANSWERS}`);

  // Render first: a template error must not leave files behind.
  for (const m of modules) if (!hasModule(kitRoot, m)) throw new ProjectError(`module "${m}" does not exist in this kit`);
  const definitions = new Map(modules.map((m) => [m, loadModule(kitRoot, m)]));
  const context = templateContext({ kitRoot, answersDoc, modules });
  const desired = renderModules({ kitRoot, modules, context, definitions });
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
  return { ...result, manifest };
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
