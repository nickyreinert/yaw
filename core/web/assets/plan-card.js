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
        review.replaceChildren(el('p', { text: `${candidate.tasks} tasks · ${candidate.phases} phases${ctx.project ? ` · Tasks: ${!candidate.hasTasks ? 'saved plan' : candidate.taskMode === 'both' ? 'local + GitHub' : candidate.taskMode === 'github' ? 'GitHub import' : 'TASKS.md'}` : ''}` }),
          el('ul', {}, ...(candidate.titles ?? []).map((title) => el('li', { text: title }))),
          ...(candidate.warnings ?? []).map((text) => el('p', { class: 'warn', text })),
          ...(candidate.foundations ?? []).map((d) => el('details', { open: true }, el('summary', { text: `${d.kind}: ${d.path}` }), el('pre', { text: d.text }))),
          el('label', { class: 'setting-toggle' }, reviewed, ' Plan and project documents reviewed'));
        review.hidden = false;
      }
      if (!reviewed.checked) { status.textContent = 'Confirm the review below.'; return; }
      candidate.foundationsReviewed = true;
      use.disabled = true;
      await ctx.onUse(candidate, answer.value);
      status.textContent = ctx.project ? 'Plan saved.' : 'Plan ready · Saved on Apply';
    } catch (e) { status.textContent = e.message; }
    finally { use.disabled = Boolean(ctx.offline); }
  } });
  const reply = el('div', {}, answer, el('div', { class: 'plan-actions' }, use), review, status);
  if (ctx.offline) reply.replaceChildren(el('pre', { text: 'yaw web' }),
    el('pre', { text: 'yaw kickoff import docs/plan/kickoff.md --dry-run' }));
  const handoff = createPlanningHandoff({ ...ctx, reply,
    getPrompt: ctx.getPrompt ?? (async () => (await (await ctx.request('kickoff-prompt', { answers: ctx.getAnswers() })).json()).prompt),
    onReply(text) { answer.value = text; invalidate(); }, busy(on) { answer.disabled = on; use.disabled = on; } });
  const panel = el('details', { class: 'plan-workflow' }, el('summary', { text: ctx.progress?.complete ? 'Refine the existing plan (optional)' : ctx.progress ? 'Continue with the saved work' : 'Start planning (optional)' }), handoff.node);
  panel.addEventListener('toggle', () => { if (panel.open) handoff.load().catch((e) => { status.textContent = e.message; }); });
  const heading = ctx.progress?.complete ? 'Project plan ready' : ctx.progress ? 'Continue your project plan' : 'Plan your project';
  const node = el('section', { class: 'plan-card', id, tabindex: -1, 'aria-labelledby': `${id}-title` },
    el(ctx.project ? 'h2' : 'h3', { id: `${id}-title`, text: heading }),
    summary, panel);
  if (ctx.progress) {
    summary.hidden = false;
    summary.append(el('p', { class: 'small muted', text: `${ctx.progress.tasks} planned task${ctx.progress.tasks === 1 ? '' : 's'} · ${ctx.progress.foundations.length}/3 reviewed foundations · ${ctx.progress.file}` }),
      ...ctx.progress.warnings.map((text) => el('p', { class: 'warn', text })));
  }
  function setInfo(info) {
    summary.hidden = !info;
    if (!info) { summary.replaceChildren(); invalidate(); return; }
    panel.open = false;
    summary.replaceChildren(el('p', { class: 'ok-text', text: `Plan accepted · ${info.tasks} tasks · ${info.foundations?.length ?? 0}/3 reviewed foundations` }),
      el('button', { type: 'button', text: 'Remove plan from setup', onclick: () => { ctx.onRemove(); setInfo(null); answer.value = ''; } }));
  }
  return { node, setInfo };
}
