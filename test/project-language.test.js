import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { projectLanguage } from '../core/web/project-language.js';
import { tmp, writeTree } from './helpers/fixtures.js';

test('detects the predominant source language without YAW configuration', () => {
  const root = tmp();
  writeTree(root, { 'src/main.ts': '', 'src/component.tsx': '', 'scripts/tool.js': '', 'package.json': '{}' });
  assert.equal(projectLanguage(root), 'typescript');
});

test('recognizes project markers when there are no sources yet', () => {
  for (const [files, expected] of [
    [{ 'tsconfig.json': '{}', 'package.json': '{}' }, 'typescript'],
    [{ 'pyproject.toml': '' }, 'python'],
    [{ 'Cargo.toml': '' }, 'rust'],
    [{ 'go.mod': '' }, 'go'],
    [{ 'Package.swift': '' }, 'swift'],
    [{ 'composer.json': '{}' }, 'php'],
  ]) {
    const root = tmp(); writeTree(root, files);
    assert.equal(projectLanguage(root), expected);
  }
});

test('ignores dependencies, build output, hidden folders and declaration/tool configuration files', () => {
  const root = tmp();
  writeTree(root, {
    'app/main.py': '', 'node_modules/a.js': '', 'vendor/b.js': '', 'dist/c.js': '',
    '.cache/d.js': '', 'eslint.config.js': '', 'types.d.ts': '',
  });
  assert.equal(projectLanguage(root), 'python');
});

test('does not follow symlinked files, directories or project roots', () => {
  const root = tmp(), outside = tmp();
  writeTree(outside, { 'main.rs': '', 'Cargo.toml': '' });
  symlinkSync(outside, join(root, 'source'));
  symlinkSync(join(outside, 'Cargo.toml'), join(root, 'Cargo.toml'));
  assert.equal(projectLanguage(root), 'Unknown');
  assert.equal(projectLanguage(join(root, 'source')), 'Unknown');
});

test('keeps missing evidence unknown and tied source languages mixed', () => {
  const root = tmp();
  writeTree(root, { 'README.md': 'typescript', 'data.json': '{}' });
  assert.equal(projectLanguage(root), 'Unknown');
  assert.equal(projectLanguage(join(root, 'missing')), 'Unknown');
  assert.equal(projectLanguage('synced · laptop'), 'Unknown');
  writeTree(root, { 'main.py': '', 'server.go': '' });
  assert.equal(projectLanguage(root), 'Mixed');
});

test('does not traverse beyond the bounded source depth', () => {
  const root = tmp(); writeTree(root, { 'a/b/c/d/e/main.py': '' });
  assert.equal(projectLanguage(root), 'Unknown');
});

test('stops after the directory-entry budget before exploring queued folders', () => {
  const root = tmp();
  writeTree(root, Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`notes-${i}.txt`, ''])));
  writeTree(root, { 'src/main.py': '' });
  assert.equal(projectLanguage(root), 'Unknown');
});
