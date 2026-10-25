// A small folder browser dialog: the browser cannot give a page the absolute path of a folder, so the local
// server lists sub-folders (GET /api/browse). Resolves with the chosen absolute path, or null on cancel.
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const button = (text, fn, cls) => { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); return b; };

// list(path | undefined) -> Promise<{ path, parent, home, yaw, entries: [{ name, path, yaw }] }>
export function pickFolder({ list, start, title = 'Choose a folder' }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', null, 'folder-picker');
    dialog.setAttribute('aria-label', title);
    const path = el('input'); path.type = 'text'; path.setAttribute('aria-label', 'Folder path'); path.spellcheck = false;
    const rows = el('div', null, 'folder-list'), message = el('p', '', 'small muted');
    const choose = button('Select this folder', () => dialog.close('ok'), 'primary');
    let here = null;
    async function go(target) {
      message.textContent = 'Reading…';
      try {
        const r = await list(target);
        here = r; path.value = r.path; message.textContent = r.entries.length ? '' : 'No sub-folders here.';
        up.disabled = !r.parent; choose.disabled = false;
        rows.replaceChildren(...r.entries.map((e) => {
          const b = button('', () => go(e.path), 'folder-row');
          b.append(el('span', `📁 ${e.name}`), ...(e.yaw ? [el('span', 'YAW project', 'pill')] : []));
          return b;
        }));
      } catch (e) { message.textContent = e.message; choose.disabled = true; }
    }
    const up = button('↑ Up', () => here?.parent && go(here.parent));
    const home = button('Home', () => go(undefined));
    path.addEventListener('keydown', (event) => { if (event.code === 'Enter') { event.preventDefault(); go(path.value); } });
    const bar = el('div', null, 'folder-bar'), actions = el('div', null, 'folder-actions');
    bar.append(up, home, path);
    actions.append(button('Cancel', () => dialog.close('cancel')), choose);
    dialog.append(el('h2', title), bar, message, rows, actions);
    dialog.addEventListener('close', () => { const ok = dialog.returnValue === 'ok' && here; dialog.remove(); resolve(ok ? here.path : null); });
    document.body.append(dialog); dialog.showModal(); go(start || undefined);
  });
}
