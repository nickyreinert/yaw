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
  if (target.workflow) return Boolean(file.module && file.module !== 'core' && !file.module.startsWith('profile:') || file.contributors?.some((name) => name !== 'core' && !name.startsWith('profile:')));
  if (target.module) return file.module === target.module || file.contributors?.includes(target.module);
  const id = target.question ?? '';
  if (id === 'idea.text' || id.startsWith('user.')) return path === 'AGENTS.md' || /^(CLAUDE|GEMINI)\.md$|^\.(claude|codex|github|agents)\//.test(path);
  if (id === 'arch.wrapper') return ['justfile', 'Makefile', 'project.sh', 'docs/engineering.md'].includes(path);
  if (id.startsWith('arch.')) return file.module?.startsWith('profile:') || /^(just\/|docs\/engineering)|^(Dockerfile|compose\.yaml|Makefile|project\.sh)$/.test(path);
  if (id.startsWith('quality.review-')) return file.module === 'review' || path.includes('/review');
  if (id.startsWith('quality.')) return ['docs/engineering.md', 'AGENTS.md'].includes(path);
  return false;
}

export function createProjectTree(root) {
  let files = [], changed = new Set(), previous = new Map(), target = {}, section = {}, openFolders = new Map();
  const body = el('div', { class: 'project-tree-body', hidden: true });
  const count = el('span', { class: 'small muted', text: 'Plan updating…', role: 'status' });
  const toggle = el('button', { type: 'button', class: 'tree-toggle', 'aria-expanded': 'false', 'aria-label': 'Expand project structure' }, decisionIcon('chevron'));
  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden;
    toggle.setAttribute('aria-expanded', String(!body.hidden));
    toggle.setAttribute('aria-label', `${body.hidden ? 'Expand' : 'Collapse'} project structure`);
  });
  root.replaceChildren(el('div', { class: 'section-heading' }, el('h2', { class: 'module-group-title' }, decisionIcon('folder'), el('span', { text: 'Project structure' })), count, toggle), body);
  function draw() {
    const render = (node) => {
      if (!node.file) {
        const children = [...node.children.values()];
        const descendants = files.filter((file) => file.path.startsWith(`${node.path}/`));
        const folderClass = descendants.some((file) => matchesTarget(file, target)) ? 'is-focused' : descendants.some((file) => matchesTarget(file, section)) ? 'in-section' : '';
        const folder = el('details', { class: 'project-tree-folder', open: openFolders.get(node.path) !== false },
          el('summary', { class: folderClass }, decisionIcon('folder'), el('code', { text: `${node.name}/` })), el('ul', {}, ...children.map(render)));
        folder.addEventListener('toggle', () => openFolders.set(node.path, folder.open));
        return el('li', {}, folder);
      }
      const file = node.file;
      return el('li', { class: ['project-tree-file', matchesTarget(file, section) ? 'in-section' : '', matchesTarget(file, target) ? 'is-focused' : '', changed.has(file.path) ? 'is-changed' : '', file.action === 'delete' ? 'is-removed' : ''].filter(Boolean).join(' '), 'data-plan-file': file.path },
        decisionIcon('file'), el('code', { text: node.name }), file.action === 'delete' ? el('small', { text: 'Remove' }) : changed.has(file.path) ? el('small', { text: 'Changed' }) : null);
    };
    body.replaceChildren(el('ul', { class: 'project-tree-list', 'aria-label': 'Planned project files' }, ...treeRows(files).map(render)));
  }
  return {
    update(next, { provisional = false } = {}) {
      files = next;
      const signatures = new Map(files.map((file) => [file.path, `${file.action}|${file.bytes}|${file.excerpt ?? ''}`]));
      changed = new Set([...signatures].filter(([path, signature]) => previous.size && previous.get(path) !== signature).map(([path]) => path));
      previous = signatures;
      count.textContent = `${files.length} files${provisional ? ' · provisional' : ''}`;
      draw();
    },
    highlight(next = {}, current = section) { target = next; section = current; draw(); },
  };
}
