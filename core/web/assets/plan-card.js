// One planning card for setup, the finished screen and Settings → Kickoff.
import { el } from './setup-cards.js';
import { createPlanningHandoff } from './planning-handoff.js';
export { CHATS } from './chat-services.js';
export function createPlanCard(ctx) {
  const id = ctx.id ?? 'plan-card';
  const status = el('p', { class: 'small muted', role: 'status' });
  const answer = el('textarea', { rows: 8, maxlength: 100000, 'aria-label': 'Planning reply', placeholder: '# Plan: …', disabled: Boolean(ctx.offline) });
  const summary = el('div', { class: 'plan-summary', hidden: true });
  const review = el('div', { hidden: true });
  const reviewed = el('input', { type: 'checkbox' });
  let candidate = null;
  const invalidate = () => { candidate = null; reviewed.checked = false; review.hidden = true; };
  answer.addEventListener('input', invalidate);
  const use = el('button', { type: 'button', text: ctx.project ? 'Review and save plan' : 'Review and use plan', disabled: Boolean(ctx.offline), onclick: async () => {
    try {
      if (!candidate) {
        candidate = await (await ctx.request(ctx.project ? 'planning-preview' : 'kickoff-reply', { text: answer.value })).json();
        review.replaceChildren(el('p', { text: `${candidate.tasks} tasks in ${candidate.phases} phases. ${ctx.project ? !candidate.hasTasks ? 'Tasks stay in the saved plan until the Tasks module is enabled.' : candidate.taskMode === 'both' ? 'Saving adds local tasks and mirrors them to GitHub.' : candidate.taskMode === 'github' ? 'GitHub issues are created separately with the import command.' : 'Saving adds local tasks to TASKS.md.' : ''}` }),
          el('ul', {}, ...(candidate.titles ?? []).map((title) => el('li', { text: title }))),
          ...(candidate.warnings ?? []).map((text) => el('p', { class: 'warn', text })),
          ...(candidate.foundations ?? []).map((d) => el('details', { open: true }, el('summary', { text: `${d.kind}: ${d.path}` }), el('pre', { text: d.text }))),
          el('label', { class: 'setting-toggle' }, reviewed, ' I reviewed this plan and its project foundations against the project choices.'));
        review.hidden = false;
      }
      if (!reviewed.checked) { status.textContent = 'Review the plan below, acknowledge it, then choose the button again.'; return; }
      candidate.foundationsReviewed = true;
      use.disabled = true;
      await ctx.onUse(candidate, answer.value);
      status.textContent = ctx.project ? 'Plan saved.' : 'Plan accepted for setup. It will be saved when you apply.';
    } catch (e) { status.textContent = e.message; }
    finally { use.disabled = Boolean(ctx.offline); }
  } });
  const reply = el('div', {}, answer, el('div', { class: 'plan-actions' }, use), review, status);
  if (ctx.offline) reply.replaceChildren(el('p', { class: 'small muted', text: 'Run yaw web and open Settings → Kickoff to paste, review and save the reply. You can also save it as docs/plan/kickoff.md and import it from your terminal.' }),
    el('code', { text: 'yaw kickoff import docs/plan/kickoff.md --dry-run' }));
  const handoff = createPlanningHandoff({ ...ctx, reply,
    getPrompt: ctx.getPrompt ?? (async () => (await (await ctx.request('kickoff-prompt', { answers: ctx.getAnswers() })).json()).prompt),
    onReply(text) { answer.value = text; invalidate(); }, busy(on) { answer.disabled = on; use.disabled = on; } });
  const panel = el('details', { class: 'plan-workflow' }, el('summary', { text: ctx.progress?.complete ? 'Refine the existing plan (optional)' : ctx.progress ? 'Continue with the saved work' : 'Start planning (optional)' }), handoff.node);
  panel.addEventListener('toggle', () => { if (panel.open) handoff.load().catch((e) => { status.textContent = e.message; }); });
  const heading = ctx.progress?.complete ? 'Project plan ready' : ctx.progress ? 'Continue your project plan' : 'Plan your project';
  const node = el('section', { class: 'plan-card', id, tabindex: -1, 'aria-labelledby': `${id}-title` },
    el(ctx.project ? 'h2' : 'h3', { id: `${id}-title`, text: heading }),
    el('p', { class: 'small muted', text: 'One reply can cover your architecture/domain, data model, UI/UX and phased build tasks. Review it here; planning again after setup is optional.' }), summary, panel);
  if (ctx.progress) {
    summary.hidden = false;
    summary.append(el('p', { class: ctx.progress.complete ? 'ok-text' : 'small muted', text: ctx.progress.complete ? 'The reviewed plan is ready. No second planning round is needed.' : 'Continue the existing plan using your confirmed project choices.' }),
      el('p', { class: 'small muted', text: `${ctx.progress.tasks} planned task${ctx.progress.tasks === 1 ? '' : 's'} · ${ctx.progress.foundations.length}/3 reviewed foundations · ${ctx.progress.file}` }),
      ...ctx.progress.warnings.map((text) => el('p', { class: 'warn', text })));
  }
  function setInfo(info) {
    summary.hidden = !info;
    if (!info) { summary.replaceChildren(); invalidate(); return; }
    panel.open = false;
    summary.replaceChildren(el('p', { class: 'ok-text', text: `Plan accepted · ${info.tasks} tasks · ${info.foundations?.length ?? 0}/3 reviewed foundations` }),
      el('p', { class: 'small muted', text: 'Review the remaining project choices. The plan and accepted documents will be saved when you apply setup.' }),
      el('button', { type: 'button', text: 'Remove plan from setup', onclick: () => { ctx.onRemove(); setInfo(null); answer.value = ''; } }));
  }
  return { node, setInfo };
}
