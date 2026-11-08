// T-041: the Code Map view shows the paged table first; the raw map sits in a collapsed "Show raw data" section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../core/web/${p}`, import.meta.url), 'utf8');
const section = (html) => html.match(/<section data-view="code-map"[\s\S]*?<\/section>/)?.[0] ?? '';

for (const page of ['assets/index.html', 'assets/dashboard.html']) {
  test(`${page}: Code Map table is primary and raw data is a collapsed details section`, () => {
    const s = section(read(page));
    assert.notEqual(s, '', 'code-map section exists');
    const areas = s.indexOf('id="map-areas"'), details = s.search(/<details\s+id="map-raw"/);
    assert.ok(areas > 0, 'table container present');
    assert.ok(details > areas, 'raw data section comes after the table');
    const open = s.slice(details, s.indexOf('>', details));
    assert.doesNotMatch(open, /\sopen[\s>=]|\sopen$/, 'collapsed by default');
    assert.match(s, /<details id="map-raw"[^>]*>\s*<summary>Show raw data<\/summary>\s*<pre id="map-content"><\/pre>\s*<\/details>/, 'raw YAML lives in a pre inside the details');
  });
}

test('workspace.js: loadMap keeps the table paged and writes the full raw map', () => {
  const src = read('assets/workspace.js');
  const load = src.slice(src.indexOf('async function loadMap()'), src.indexOf('async function loadNotifications()'));
  assert.match(load, /pagedTable\('code-map'/, 'table is paged');
  assert.match(load, /\$\('map-content'\)\.textContent = map\.content/, 'raw text is the full map content');
  assert.doesNotMatch(load, /slice|substring|substr|\.length\s*>/, 'raw text is not cut');
  assert.match(src, /Hide raw data/, 'toggle label switches to Hide raw data');
  assert.match(src, /\$\('map-raw'\)\.addEventListener\('toggle'/, 'summary label follows the open state');
});
