// Dashboard hint only: configured language first, then bounded local filename evidence.
// Never read source contents, dependencies, hidden folders or linked directories.
import { lstatSync, opendirSync } from 'node:fs';
import { extname, isAbsolute, join } from 'node:path';
import { readManifest } from '../render/manifest.js';
import { readAnswers } from '../render/project.js';

const extensions = new Map(Object.entries({
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  swift: 'swift', php: 'php', rb: 'ruby', cs: 'csharp', c: 'c', cpp: 'cpp', cc: 'cpp',
  dart: 'dart', vue: 'vue', svelte: 'svelte', html: 'html',
}));
const markers = new Map(Object.entries({
  'tsconfig.json': 'typescript', 'go.mod': 'go', 'Cargo.toml': 'rust',
  'Package.swift': 'swift', 'pyproject.toml': 'python', 'requirements.txt': 'python',
  'setup.py': 'python', 'composer.json': 'php', Gemfile: 'ruby', 'pom.xml': 'java',
  'pubspec.yaml': 'dart', 'package.json': 'javascript',
}));
const excluded = new Set(['node_modules', 'vendor', 'target', 'dist', 'build', 'coverage', 'venv', '__pycache__']);

export function projectLanguage(root) {
  if (typeof root !== 'string' || !isAbsolute(root)) return 'Unknown';
  try {
    if (!lstatSync(root).isDirectory()) return 'Unknown';
  } catch { return 'Unknown'; }
  try {
    if (readManifest(root)) {
      const value = readAnswers(root).answers?.['arch.language'];
      if (typeof value === 'string' && value.trim() && value !== 'auto') return value;
    }
  } catch { /* A missing or unreadable setup must not prevent filename detection. */ }

  const counts = new Map(), hints = new Set(), queue = [[root, 0]];
  let remaining = 2000;
  for (let i = 0; i < queue.length && remaining > 0; i++) {
    const [folder, depth] = queue[i];
    let dir;
    try {
      dir = opendirSync(folder);
      let entry;
      while (remaining > 0 && (entry = dir.readSync())) {
        remaining--;
        if (entry.name.startsWith('.') || excluded.has(entry.name)) continue;
        if (entry.isDirectory() && depth < 4) queue.push([join(folder, entry.name), depth + 1]);
        if (!entry.isFile()) continue;
        if (depth === 0 && markers.has(entry.name)) hints.add(markers.get(entry.name));
        // Tool configuration and declaration files should not outweigh application sources.
        if (/\.config\.[cm]?[jt]s$|\.d\.[cm]?ts$/.test(entry.name)) continue;
        const language = extensions.get(extname(entry.name).slice(1));
        if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
      }
    } catch { /* Unavailable folders contribute no evidence. */ }
    finally { dir?.closeSync(); }
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  if (ranked.length) return ranked[0][1] === ranked[1]?.[1] ? 'Mixed' : ranked[0][0];
  // A TS project also commonly has package.json; the more specific marker wins.
  if (hints.has('typescript')) hints.delete('javascript');
  return hints.size === 1 ? [...hints][0] : hints.size ? 'Mixed' : 'Unknown';
}
