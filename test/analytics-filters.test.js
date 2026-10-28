import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeFacet, facetOptions, matchesFacets, readFacets, facetsForScope, UNAVAILABLE } from '../core/web/assets/analytics-filters.js';
const rows = [
  { deviceId: 'local', project: '/work/apps/one', language: 'javascript', agent: 'codex', model: 'a' },
  { deviceId: 'local', project: '/work/apps/two', language: 'python', agent: 'claude', model: 'b' },
  { deviceId: 'other', project: '/work/archive/three', language: 'python', agent: 'codex', model: 'c' },
  { deviceId: 'remote', source: 'synced', project: 'synced:remote', agent: 'codex', model: 'd' },
];
test('column browser combines multiple values with OR and columns with AND', () => {
  const selection = { device: ['local', 'other'], agent: ['codex'], language: ['python', 'javascript'] };
  assert.deepEqual(rows.filter((r) => matchesFacets(r, selection, undefined, '/work')), [rows[0], rows[2]]);
  assert.equal(matchesFacets(rows[0], { folder: ['/work/app'] }, undefined, '/work'), false);
  assert.equal(matchesFacets(rows[0], { folder: ['/work/apps'] }, undefined, '/work'), true);
});
test('earlier choices update lists and prune only incompatible later selections', () => {
  const next = changeFacet(rows, { model: ['a', 'c'], agent: ['codex'] }, 'device', ['other'], '/work');
  assert.deepEqual(next.model, ['c']); assert.deepEqual(next.agent, ['codex']);
  assert.deepEqual([...facetOptions(rows, next, 'project', '/work').keys()], ['/work/archive/three']);
  assert.deepEqual(changeFacet(rows, next, 'device', [], '/work').model, ['c']);
});
test('synced rows never invent folder/project paths and repeated URL filters round-trip', () => {
  assert.equal(matchesFacets(rows[3], { project: [UNAVAILABLE] }), true);
  assert.equal(matchesFacets(rows[3], { folder: ['/work'] }), false);
  const selected = readFacets(new URLSearchParams('device=local&device=other&device=local&agent=codex&model='));
  assert.deepEqual(selected.device, ['local', 'other']); assert.deepEqual(selected.agent, ['codex']); assert.deepEqual(selected.model, []);
  const params = new URLSearchParams();
  for (const [key, values] of Object.entries(selected)) for (const value of values) params.append(key, value);
  assert.deepEqual(readFacets(params), selected);
});

test('workspace scope keeps agent/model filters and clears hidden global filters from old URLs', () => {
  assert.deepEqual(facetsForScope('workspace').map(([key]) => key), ['agent', 'model']);
  assert.deepEqual(facetsForScope().map(([key]) => key), ['device', 'folder', 'project', 'language', 'agent', 'model']);
  const params = new URLSearchParams('device=other&folder=/unrelated&project=/unrelated/old&language=python&agent=codex&model=a&model=c');
  const selection = readFacets(params, 'workspace');
  for (const key of ['device', 'folder', 'project', 'language']) assert.deepEqual(selection[key], []);
  assert.deepEqual(selection.agent, ['codex']);
  assert.deepEqual(selection.model, ['a', 'c']);
  assert.deepEqual(rows.filter((row) => matchesFacets(row, selection)), [rows[0], rows[2]]);
  assert.deepEqual([...facetOptions(rows, changeFacet(rows, selection, 'agent', ['claude']), 'model').keys()], ['b']);
});
