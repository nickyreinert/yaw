// Kit access for the render engine: version, module definitions, rendering module outputs.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from '../lib/yaml.js';
import { formatError } from '../lib/schema.js';
import { loadSchemas } from '../schema/validate.js';
import { render } from './template.js';
import { compose, SHARED_FILES } from './compose.js';
import { checkRelPath } from './files.js';

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

// Context for templates (ADR-0002): computed in JS, templates only read it.
// Answers are nested by question group: "idea.text" is answers.idea.text.
export function templateContext({ kitRoot, answersDoc, modules }) {
  const answers = {};
  for (const [id, value] of Object.entries(answersDoc.answers ?? {})) {
    const [group, name] = id.split('.');
    answers[group] ??= {};
    answers[group][name] = value;
  }
  return {
    kit: { version: kitVersion(kitRoot) },
    mode: answersDoc.mode,
    answers,
    proposal: answersDoc.proposal ?? null,
    agents: answersDoc.answers?.['user.agents'] ?? [],
    profiles: answersDoc.proposal?.profiles ?? [],
    modules: [...modules],
  };
}

// Render the outputs of the given modules.
// -> Map<path, { module, content: Buffer, fragments: [{ module, hash }] }>
export function renderModules({ kitRoot, modules, context, definitions }) {
  const owned = new Map();
  const shared = new Map();
  const addPart = (path, part) => {
    if (!shared.has(path)) shared.set(path, []);
    shared.get(path).push(part);
  };
  for (const name of modules) {
    const def = definitions?.get(name) ?? loadModule(kitRoot, name);
    const dir = join(moduleDir(kitRoot, name), 'templates');
    for (const path of def.outputs?.templates ?? []) {
      checkRelPath(path);
      const tmpl = join(dir, `${path}.tmpl`);
      const plain = join(dir, path);
      const hasTmpl = existsSync(tmpl);
      const hasPlain = existsSync(plain);
      if (hasTmpl && hasPlain) throw new KitError(`module "${name}": both ${path} and ${path}.tmpl exist`);
      if (!hasTmpl && !hasPlain) throw new KitError(`module "${name}": template ${path} not found`);
      const content = hasTmpl
        ? Buffer.from(render(readFileSync(tmpl, 'utf8'), context, { file: `modules/${name}/templates/${path}.tmpl` }), 'utf8')
        : readFileSync(plain);
      if (SHARED_FILES[path]) {
        addPart(path, { module: name, kind: 'template', content });
      } else if (owned.has(path)) {
        throw new KitError(`${path} is written by modules "${owned.get(path).module}" and "${name}" but is not a shared file`);
      } else {
        owned.set(path, { module: name, content, fragments: [] });
      }
    }
    if (def.agentsMd) addPart('AGENTS.md', { module: name, kind: 'agentsMd', content: def.agentsMd });
  }
  for (const [path, parts] of shared) {
    const spec = SHARED_FILES[path];
    const { content, fragments } = compose(path, spec, parts);
    if (content !== null) owned.set(path, { module: spec.owner, content: Buffer.from(content, 'utf8'), fragments });
  }
  return owned;
}
