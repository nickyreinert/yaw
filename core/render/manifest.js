// Read and write .yaw/manifest.json (doc 01 §5, ADR-0017). Always validated against manifest.schema.json.

import { formatError } from '../lib/schema.js';
import { MANIFEST, readProjectFile, writeAtomic, removeFile } from './files.js';
import { schemas } from './kit.js';

export class ManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ManifestError';
  }
}

export function validateManifest(manifest) {
  const errors = schemas().validate('manifest.schema.json', manifest);
  if (errors.length > 0) throw new ManifestError(errors.map((e) => formatError(e, MANIFEST)).join('\n'));
  return manifest;
}

// -> manifest object, or null when the project has none.
export function readManifest(root) {
  const buf = readProjectFile(root, MANIFEST, { kitOwned: true });
  if (buf === null) return null;
  let manifest;
  try {
    manifest = JSON.parse(buf.toString('utf8'));
  } catch (e) {
    throw new ManifestError(`${MANIFEST}: invalid JSON: ${e.message}`);
  }
  return validateManifest(manifest);
}

// Files sorted by path and fragments by module, so the same project state gives the same bytes.
export function normaliseManifest(manifest) {
  const files = [...manifest.files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => {
      const out = { path: f.path, module: f.module, hash: f.hash, managed: f.managed };
      if (f.fragments && f.fragments.length > 0) out.fragments = [...f.fragments].sort((a, b) => (a.module < b.module ? -1 : 1));
      return out;
    });
  return { ...manifest, files };
}

export function writeManifest(root, manifest) {
  const out = validateManifest(normaliseManifest(manifest));
  writeAtomic(root, MANIFEST, `${JSON.stringify(out, null, 2)}\n`, { kitOwned: true });
  return out;
}

export function deleteManifest(root) {
  removeFile(root, MANIFEST, { kitOwned: true });
}
