// Review prompts editor (ADR-0056), shared by workspace Settings (project overrides) and Global Settings (your
// blueprint). Each reviewer's prompt comes from the first layer that has it: project, blueprint, kit default.
import { button, el } from './settings-view.js';

const SOURCE = { project: 'This project', global: 'Your blueprint', kit: 'Kit default' };

// scope: 'project' | 'global'. load(): fetches the data again; api(name, input): a CSRF-protected action.
export function renderReviewPrompts(root, { data, scope, api, load, report }) {
  root.replaceChildren();
  if (scope === 'project' && !data.enabled) {
    root.append(el('p', 'Review agents are off in this project. Turn on "Review agents" on the Interview tab, then adjust their prompts here.', 'muted'));
    return;
  }
  root.append(el('p', scope === 'project'
    ? 'What each review agent is told to look for. A prompt saved here is stored in .yaw/review/ and committed with the project, so the team and the push gate use the same one; otherwise your blueprint (Global → Settings) or the kit default applies. Read-only behaviour and the PASS/FINDINGS verdict are fixed and cannot be edited away.'
    : 'Your blueprint: the prompts every project uses unless it saves its own (Workspace → Settings → Review prompts). Stored in ~/.yaw/review/. Read-only behaviour and the PASS/FINDINGS verdict are fixed and cannot be edited away.', 'small muted'));
  for (const p of data.prompts) root.append(card(p));

  function card(p) {
    const own = scope === 'project' ? p.project : p.global;
    const inherited = scope === 'project' ? (p.global ? ['global', p.global.text] : ['kit', p.kit]) : ['kit', p.kit];
    const box = el('section', null, 'card review-prompt'), head = el('div', null, 'settings-group-head');
    const from = own ? scope : inherited[0];
    head.append(el('h2', p.label), el('span', SOURCE[from], `pill${from === 'kit' ? ' muted-pill' : ''}`));
    box.dataset.kind = p.kind;
    const area = el('textarea', null, 'prompt-text');
    area.value = own ? own.text : inherited[1];
    area.rows = Math.min(18, Math.max(6, area.value.split('\n').length + 1));
    area.spellcheck = true;
    area.setAttribute('aria-label', `${p.label} prompt`);
    const status = el('p', own ? `Saved in ${own.path}.` : `Inherited from: ${SOURCE[inherited[0]].toLowerCase()}. Edit and save to give ${scope === 'project' ? 'this project' : 'all projects'} its own.`, 'small muted');
    const save = button(scope === 'project' ? 'Save for this project' : 'Save blueprint', () => act('review-prompt-save', { text: area.value }), 'primary');
    const reset = button(scope === 'project' ? (p.global ? 'Use blueprint' : 'Use kit default') : 'Reset to kit default', () => {
      if (confirm(`Remove the ${scope === 'project' ? 'project' : 'blueprint'} prompt for ${p.label}? The ${SOURCE[inherited[0]].toLowerCase()} applies again.`)) act('review-prompt-remove', {});
    });
    save.disabled = true;
    reset.disabled = !own;
    reset.title = own ? `Delete ${own.path}` : 'Nothing saved at this level';
    area.addEventListener('input', () => { save.disabled = area.value === (own ? own.text : inherited[1]) || !area.value.trim(); });
    const actions = el('div', null, 'actions');
    actions.append(save, reset);
    box.append(head, area, actions, status);
    return box;

    async function act(name, extra) {
      save.disabled = true; reset.disabled = true;
      try {
        const r = await api(name, { scope, kind: p.kind, expected: own?.hash ?? null, ...extra });
        await load();
        root.querySelector(`[data-kind="${p.kind}"] .small`)?.replaceChildren(r.message);
      } catch (e) {
        status.textContent = e.message; status.className = 'small warn';
        save.disabled = false; reset.disabled = !own;
      }
    }
  }
}
