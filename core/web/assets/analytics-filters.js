// One column browser for workspace/global Analytics and Global Overview.
// OR within a column, AND across columns. Earlier columns constrain later choices.
export const FACETS = [['device', 'Device'], ['folder', 'Folders'], ['project', 'Projects'],
  ['language', 'Programming language'], ['agent', 'Agent'], ['model', 'Model']];
export const FACET_KEYS = FACETS.map(([key]) => key);
export const UNAVAILABLE = '(unavailable)';
export function facetValues(row, key, root = '') {
  if (key === 'device') return [row.deviceId ?? 'local'];
  if (key === 'language') return [row.language ?? 'Unknown'];
  if (key === 'project' || key === 'folder') {
    if (row.source === 'synced' || !row.project?.startsWith('/')) return [UNAVAILABLE];
    if (key === 'project') return [row.project];
    let parent = row.project.slice(0, row.project.lastIndexOf('/')) || '/';
    const parents = [];
    while (parent) {
      parents.push(parent);
      if (parent === root || parent === '/' || root && !parent.startsWith(`${root}/`)) break;
      parent = parent.slice(0, parent.lastIndexOf('/')) || '/';
    }
    return parents;
  }
  return [row[key] ?? 'Unknown'];
}
export function matchesFacets(row, selection, keys = FACET_KEYS, root = '') {
  return keys.every((key) => !selection[key]?.length || facetValues(row, key, root).some((value) => selection[key].includes(value)));
}
export function facetOptions(rows, selection, key, root = '') {
  const before = FACET_KEYS.slice(0, FACET_KEYS.indexOf(key)), counts = new Map();
  for (const row of rows) {
    if (!matchesFacets(row, selection, before, root)) continue;
    for (const value of facetValues(row, key, root)) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}
export function changeFacet(rows, selection, key, values, root = '') {
  const next = Object.fromEntries(FACET_KEYS.map((k) => [k, [...(selection[k] ?? [])]]));
  next[key] = [...new Set(values)];
  for (const downstream of FACET_KEYS.slice(FACET_KEYS.indexOf(key) + 1)) {
    const available = facetOptions(rows, next, downstream, root);
    next[downstream] = next[downstream].filter((v) => available.has(v));
  }
  return next;
}
export function readFacets(params) {
  return Object.fromEntries(FACET_KEYS.map((key) => [key, [...new Set(params.getAll(key).filter(Boolean))]]));
}
export function renderFacetBrowser({ rows, selection, root = '', label = (_key, value) => value, onChange }) {
  const browser = document.createElement('div'); browser.className = 'facet-browser';
  for (const [key, title] of FACETS) {
    const field = document.createElement('fieldset'); field.className = 'facet-column';
    const legend = document.createElement('legend'); legend.textContent = title;
    const list = document.createElement('div'); list.className = 'facet-list';
    const counts = facetOptions(rows, selection, key, root), selected = selection[key] ?? [];
    const add = (value, text, count) => {
      const option = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.checked = value === null ? !selected.length : selected.includes(value);
      input.setAttribute('aria-label', `${title}: ${text}`);
      input.addEventListener('change', () => {
        const values = value === null ? [] : input.checked ? [...selected, value] : selected.filter((v) => v !== value);
        onChange(key, values);
      });
      const name = document.createElement('span'); name.textContent = text; name.title = value ?? text;
      const total = document.createElement('small'); total.textContent = count;
      option.append(input, name, total); list.append(option);
    };
    const eligible = rows.filter((r) => matchesFacets(r, selection, FACET_KEYS.slice(0, FACET_KEYS.indexOf(key)), root));
    add(null, 'All', eligible.length);
    for (const value of [...new Set([...counts.keys(), ...selected])].sort((a, b) => label(key, a).localeCompare(label(key, b)))) {
      add(value, label(key, value), counts.get(value) ?? 0);
    }
    field.append(legend, list); browser.append(field);
  }
  return browser;
}
