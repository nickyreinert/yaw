// The interview's local, expandable file plan. User-controlled paths are text nodes only.
import { el, decisionIcon } from './setup-cards.js';

export function treeRows(files) {
  const root = new Map();
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split('/');
    let children = root, path = '';
    parts.forEach((name, index) => {
      path = path ? `${path}/${name}` : name;
      if (!children.has(name)) children.set(name, { name, path, children: new Map() });
      const node = children.get(name);
      if (index === parts.length - 1) node.file = file;
      children = node.children;
    });
  }
  return [...root.values()];
}

export function matchesTarget(file, target = {}) {
  const path = file.path;
  if (target.setup) return path.startsWith('.yaw/') || path === 'AGENTS.md';
  if (target.workflow) return path === 'AGENTS.md' || path === 'docs/engineering.md' || Boolean(file.module && file.module !== 'core' && !file.module.startsWith('profile:') || file.contributors?.some((name) => name !== 'core' && !name.startsWith('profile:')));
  if (target.module) return file.module === target.module || file.contributors?.includes(target.module);
  const id = target.question ?? '';
  if (id === 'idea.team') return path === 'AGENTS.md' || file.module === 'team' || file.contributors?.includes('team');
  if (id === 'idea.text' || id === 'user.expertise') return path === 'AGENTS.md';
  if (id.startsWith('user.')) return path === 'AGENTS.md' || /^(CLAUDE|GEMINI)\.md$|^\.(claude|codex|agents)\/|^\.github\/(agents|instructions)\/|^\.github\/copilot-instructions\.md$/.test(path);
  if (id === 'arch.wrapper') return ['justfile', 'Makefile', 'project.sh', 'docs/engineering.md'].includes(path);
  if (id.startsWith('arch.')) return file.module?.startsWith('profile:') || /^(just\/|docs\/engineering)|^(Dockerfile|compose\.yaml|Makefile|project\.sh)$/.test(path);
  if (id.startsWith('quality.review-')) return file.module === 'review' || path.includes('/review');
  if (id.startsWith('quality.')) return ['docs/engineering.md', 'AGENTS.md'].includes(path);
  return false;
}

export function filePurpose(path) {
  if (path === 'AGENTS.md') return 'Agent entry point';
  if (['CLAUDE.md', 'GEMINI.md'].includes(path)) return 'Rules import';
  if (['Makefile', 'project.sh'].includes(path)) return 'Command wrapper';
  if (path === 'justfile' || path.endsWith('.just')) return 'Project commands';
  if (path === '.gitignore') return 'Ignored files';
  if (path === '.yaw/answers.yaml') return 'Project choices';
  if (path === '.yaw/manifest.json') return 'Generated file index';
  if (path === 'docs/engineering.md') return 'Coding rules';
  if (path.endsWith('SKILL.md')) return 'Agent skill';
  if (path.includes('/ISSUE_TEMPLATE/')) return 'Issue form';
  if (path.endsWith('pull_request_template.md')) return 'PR template';
  if (path.endsWith('hooks.json') || path.endsWith('settings.json')) return 'Agent configuration';
  if (path.includes('docs/spec/')) return 'Project specification';
  if (path.includes('docs/standards')) return 'Coding standards';
  if (path.includes('docs/plan/')) return 'Project plan';
  if (path.endsWith('README.md')) return 'Project overview';
  if (path.endsWith('package.json')) return 'Dependencies and scripts';
  if (path.startsWith('src/') || path.startsWith('public/')) return 'Starter code';
  return 'Project file';
}

export function folderPurpose(path) {
  const known = { '.yaw': 'YAW setup and records', '.claude': 'Claude instructions and configuration', '.codex': 'Codex configuration', '.agents': 'Shared agent skills', '.github': 'GitHub collaboration', '.github/workflows': 'Continuous integration', '.github/ISSUE_TEMPLATE': 'Issue forms', '.claude/agents': 'Review sub-agents', '.decisions': 'Decision journal', just: 'Project command recipes', docs: 'Project documentation', 'docs/spec': 'Project specifications', 'docs/plan': 'Project plans', src: 'Application source', public: 'Static assets', test: 'Automated tests', tests: 'Automated tests' };
  return known[path] ?? 'Project files';
}

const ACTION = { create: 'new', update: 'changed', write: 'write', kept: 'kept', missing: 'restore', delete: 'remove' };
export function filesForStep(files, section, target = {}) {
  return files.filter((file) => matchesTarget(file, section) || matchesTarget(file, target));
}

// Both the final review and the console use the same folder hierarchy and purpose labels.
export function fileTreeEntries(files, options = {}) {
  const record = (node, search, children = [], key = null) => ({ node, search: search.toLocaleLowerCase(), children, key });
  const render = (node) => {
    if (!node.file) {
      const children = [...node.children.values()].map(render), key = `folder/${node.path}`;
      const purpose = folderPurpose(node.path), open = options.expanded?.get(node.path) ?? options.expandFolders ?? false;
      const summary = el('summary', { class: 'review-summary', title: `${node.path}/ — ${purpose}` }, options.icons === false ? null : decisionIcon('folder'),
        el('code', { class: 'review-branch-label', text: `${node.name}/` }), el('small', { class: 'review-count', text: purpose }));
      const branch = el('details', { class: 'review-branch project-tree-folder', 'data-review-key': key, 'data-plan-folder': node.path }, summary,
        el('div', { class: 'review-children' }, ...children.map((child) => child.node)));
      branch.open = open;
      summary.addEventListener('click', () => {
        options.expanded?.set(node.path, !branch.open);
        options.onExpand?.(key, !branch.open);
        options.onFolder?.({ path: node.path, purpose, files: files.filter((file) => file.path.startsWith(`${node.path}/`)) });
      });
      return record(branch, `${node.path} ${purpose}`, children, key);
    }
    const file = node.file, purpose = filePurpose(file.path);
    const note = `${purpose} · ${ACTION[file.action] ?? 'planned'}`;
    const cls = ['review-file-row', options.onFile ? 'project-tree-file' : '', matchesTarget(file, options.section) ? 'in-section' : '', matchesTarget(file, options.target) ? 'is-focused' : '', options.changed?.has(file.path) ? 'is-changed' : ''].filter(Boolean).join(' ');
    const row = el(options.onFile ? 'button' : 'div', { class: cls, 'data-review-file': file.path, 'data-plan-file': file.path, title: `${file.path} — ${note}`,
      ...(options.onFile ? { type: 'button', 'aria-pressed': String(options.selected === file.path), 'aria-label': `Preview ${file.path}`, onclick: () => options.onFile(file) } : {}) },
      options.icons === false ? null : decisionIcon('file'), el('code', { text: node.name }), el('small', { class: 'muted', text: note }));
    return { ...record(row, `${file.path} ${note}`), file };
  };
  return treeRows(files).map(render);
}

export function createProjectTree(root, { readFile } = {}) {
  let files = [], changed = new Set(), previous = new Map(), previousFiles = [], target = {}, section = {}, selected = null, requestRevision = 0;
  // The last update's added, changed and removed files flash briefly; removed ones stay visible until it ends.
  const FLASH_MS = 1600;
  let flash = null, flashTimer;
  const flashing = () => flash && performance.now() - flash.at < FLASH_MS;
  const expanded = new Map();
  let renderedFiles = [];
  const tree = el('div', { class: 'review-tree project-tree-items', 'aria-label': 'Planned project files' });
  const previewTitle = el('h3', { text: 'File content' });
  const preview = el('pre', { class: 'project-file-content', text: 'Select a file to preview its content.' });
  const previewPane = el('aside', { class: 'project-file-preview', 'aria-label': 'File content preview' }, previewTitle, preview);
  const body = el('div', { class: 'project-tree-body', hidden: true }, tree, previewPane);
  const count = el('span', { class: 'small muted', text: 'Plan updating…', role: 'status' });
  body.id = `${root.id || 'project-structure'}-body`;
  const toggle = el('button', { type: 'button', class: 'project-structure-heading', 'aria-expanded': 'false', 'aria-controls': body.id, 'aria-label': 'Expand project structure' },
    el('span', { class: 'project-structure-title', text: 'Project structure' }), count,
    el('span', { class: 'tree-toggle', 'aria-hidden': 'true' }, decisionIcon('chevron')));
  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    toggle.setAttribute('aria-label', `${body.hidden ? 'Expand' : 'Collapse'} project structure`);
  });
  root.replaceChildren(toggle, body);
  function markSelection() {
    for (const row of renderedFiles) row.node.setAttribute('aria-pressed', String(row.file.path === selected));
  }
  function clearPreview() {
    selected = null; requestRevision++; markSelection();
    previewTitle.textContent = 'File content'; preview.textContent = 'Select a file to preview its content.';
  }
  async function selectFile(file) {
    const current = ++requestRevision;
    selected = file.path; previewTitle.textContent = file.path; preview.textContent = 'Loading…';
    markSelection();
    try {
      const result = await readFile(file.path);
      if (current !== requestRevision) return;
      previewTitle.textContent = `${file.path} · ${result.source ?? 'Preview'}`;
      preview.textContent = result.content ?? result.message;
    } catch (error) { if (current === requestRevision) preview.textContent = error.message; }
  }
  function draw() {
    const active = flashing();
    const visible = filesForStep(active ? [...files, ...flash.removed] : files, section, target);
    const entries = fileTreeEntries(visible, { expanded, expandFolders: true, icons: false, target, section, selected, changed, onFile: selectFile,
      onFolder: (folder) => { clearPreview(); previewTitle.textContent = `${folder.path}/`; preview.textContent = `${folder.purpose}\n${folder.files.length} files`; } });
    renderedFiles = [];
    const collect = (entries) => { for (const entry of entries) { if (entry.file) renderedFiles.push(entry); collect(entry.children); } };
    collect(entries);
    tree.replaceChildren(...entries.map((entry) => entry.node));
    if (!visible.length) tree.append(el('p', { class: 'small muted', text: 'No files affected by this step.' }));
    count.textContent = `${visible.length} / ${files.length} files${root.dataset.provisional === 'true' ? ' · provisional' : ''}`;
    if (!active) return;
    const delay = `-${Math.round(performance.now() - flash.at)}ms`;
    for (const row of renderedFiles) {
      const kind = flash.added.has(row.file.path) ? 'added' : flash.changed.has(row.file.path) ? 'changed' : row.file.removed ? 'removed' : null;
      if (kind) { row.node.classList.add(`flash-${kind}`); row.node.style.animationDelay = delay; }
    }
    const delta = [[flash.added.size, '+'], [flash.changed.size, '~'], [flash.removed.length, '−']].filter(([n]) => n).map(([n, sign]) => `${sign}${n}`).join(' ');
    count.append(' · ', el('span', { class: 'project-tree-delta', text: delta }));
  }
  function startFlash(next) {
    const known = new Set(next.map((file) => file.path));
    const added = new Set(next.filter((file) => !previous.has(file.path)).map((file) => file.path));
    const removed = previousFiles.filter((file) => !known.has(file.path)).map((file) => ({ ...file, action: 'delete', removed: true }));
    const updated = new Set([...changed].filter((path) => !added.has(path)));
    if (!added.size && !updated.size && !removed.length) return;
    flash = { at: performance.now(), added, changed: updated, removed };
    toggle.classList.remove('is-flashing'); void toggle.offsetWidth; toggle.classList.add('is-flashing');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash = null; toggle.classList.remove('is-flashing'); draw(); }, FLASH_MS);
  }
  return {
    update(next, { provisional = false } = {}) {
      files = next;
      const signatures = new Map(files.map((file) => [file.path, `${file.action}|${file.bytes}|${file.excerpt ?? ''}`]));
      changed = new Set([...signatures].filter(([path, signature]) => previous.size && previous.get(path) !== signature).map(([path]) => path));
      // Switching between the provisional and the real plan is not a change the user made.
      if (previous.size && root.dataset.provisional === String(provisional)) startFlash(files);
      previous = signatures; previousFiles = files; root.dataset.provisional = String(provisional);
      const file = selected && filesForStep(files, section, target).find((entry) => entry.path === selected);
      if (file) selectFile(file); else clearPreview();
      draw();
    },
    highlight(next = {}, current = section) {
      if (JSON.stringify(current) !== JSON.stringify(section)) { expanded.clear(); clearPreview(); }
      target = next; section = current;
      if (selected && !filesForStep(files, section, target).some((file) => file.path === selected)) clearPreview();
      draw();
    },
    destroy() { requestRevision++; clearTimeout(flashTimer); },
  };
}
