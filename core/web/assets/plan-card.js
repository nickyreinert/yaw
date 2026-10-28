// "Plan with an AI chat" (setup step 3): a planning prompt built from the answers so far, links to chat services,
// and a box for the chat's answer. The answer carries the idea in business words, a stack recommendation and the
// task list; the setup takes them over (idea, stack answers, docs/plan/kickoff.md, TASKS.md). Nothing leaves this
// page by itself: the user copies the prompt and pastes the answer. DOM only through createElement.
import { el } from './setup-cards.js';

// Chat services that take a pasted prompt. Plain links; opened in a new tab, no referrer.
import { chatLinks } from './chat-services.js';
export { CHATS } from './chat-services.js';

// ctx: { request(action, input) -> Response, getAnswers() -> explicit answers so far, onUse(reply, text), onRemove() }
export function createPlanCard(ctx) {
  const status = el('p', { class: 'small muted', role: 'status' });
  const promptText = el('pre', { class: 'plan-prompt' });
  const answer = el('textarea', { id: 'plan-answer', rows: '8', maxlength: '100000', 'aria-label': 'Answer of the planning chat', placeholder: '# Plan: …' });
  const summary = el('div', { class: 'plan-summary', hidden: true });
  const panel = el('div', { class: 'plan-panel', hidden: true });
  const toggle = el('button', { type: 'button', id: 'plan-toggle', 'aria-expanded': 'false', 'aria-controls': 'plan-steps', text: 'Get the planning prompt' });
  const review = el('div', { hidden: true });
  const reviewed = el('input', { type: 'checkbox', id: 'foundations-reviewed' });
  let candidate = null;
  answer.addEventListener('input', () => { candidate = null; reviewed.checked = false; review.hidden = true; });

  async function fetchPrompt() {
    const body = await (await ctx.request('kickoff-prompt', { answers: ctx.getAnswers() })).json();
    promptText.textContent = body.prompt;
    return body.prompt;
  }
  const copy = el('button', { type: 'button', class: 'primary', text: 'Copy prompt', onclick: async () => {
    try {
      const prompt = await fetchPrompt();
      await navigator.clipboard.writeText(prompt);
      status.textContent = 'Prompt copied. Paste it into a chat.';
    } catch (e) { status.textContent = e.message || 'Could not copy; select the prompt text instead.'; }
  } });
  const use = el('button', { type: 'button', text: 'Use this plan', onclick: async () => {
    try {
      const reply = candidate ?? await (await ctx.request('kickoff-reply', { text: answer.value })).json();
      if (reply.foundations?.length) {
        if (!candidate) {
          candidate = reply;
          review.replaceChildren(...reply.foundations.map((d) => el('details', { open: true }, el('summary', { text: `${d.kind}: ${d.path}` }), el('pre', { text: d.text }))),
            el('label', {}, reviewed, ' I reviewed these project foundations, including reused documents, and accept them as the baseline.'));
          review.hidden = false;
        }
        if (!reviewed.checked) { status.textContent = 'Review the foundation documents below, acknowledge them, then choose Use this plan.'; return; }
        reply.foundationsReviewed = true;
      }
      ctx.onUse(reply, answer.value);
      status.textContent = '';
    } catch (e) { status.textContent = e.message; }
  } });

  const steps = el('ol', { class: 'plan-steps', id: 'plan-steps' },
    el('li', {}, el('strong', { text: 'Copy the prompt' }), el('div', { class: 'plan-actions' }, copy),
      el('details', {}, el('summary', { text: 'Show the prompt' }), promptText)),
    el('li', {}, el('strong', { text: 'Open a chat and paste it' }),
      el('p', { text: 'You can also use your configured local model or draft the documents manually.' }),
      chatLinks()),
    el('li', {}, el('strong', { text: 'Paste the answer here' }), answer, review, el('div', { class: 'plan-actions' }, use)));
  panel.append(steps, status);
  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open));
    if (open) fetchPrompt().catch((e) => { status.textContent = e.message; });
  });

  const node = el('section', { class: 'plan-card', id: 'plan-card', tabindex: '-1', 'aria-labelledby': 'plan-title' },
    el('h3', { id: 'plan-title', text: 'Plan with an AI chat' }), el('span', { class: 'pill', text: 'optional' }),
    el('ul', { class: 'plain-bullets small' },
      el('li', { text: 'Draft and review architecture/domain, data model and UI/UX foundations, then derive tasks with acceptance criteria' }),
      el('li', { text: 'Discuss hosting, library, service and budget constraints here, or use Pro’s optional Architecture cards before copying the prompt' }),
      el('li', { text: 'You copy the prompt and paste the answer: nothing is sent from here' }),
      el('li', { text: 'Only for ideas that are not confidential' })),
    toggle, panel, summary);

  // info: the parsed reply, or null to show the start again
  function setInfo(info) {
    summary.hidden = !info; toggle.hidden = Boolean(info); panel.hidden = Boolean(info) || panel.hidden;
    if (!info) { summary.replaceChildren(); candidate = null; reviewed.checked = false; review.hidden = true; return; }
    summary.replaceChildren(
      el('p', { class: 'ok-text', text: 'Plan loaded' }),
      el('ul', { class: 'plain-bullets' },
        ...(info.idea ? [el('li', { text: 'Idea filled in above' })] : []),
        ...(info.foundations?.length ? [el('li', { text: `Reviewed foundations: ${info.foundations.map((d) => d.path).join(', ')}` })] : []),
        ...(info.language || info.runsOn ? [el('li', { text: `Stack: ${info.language ?? '?'} · ${info.runsOn ?? '?'}; check it in step 4` })] : []),
        ...(info.tasks ? [el('li', { text: `${info.tasks} task${info.tasks === 1 ? '' : 's'} in ${info.phases} phase${info.phases === 1 ? '' : 's'}: saved as docs/plan/kickoff.md and added to TASKS.md` })] : []),
        ...info.warnings.map((w) => el('li', { class: 'warn-text', text: w }))),
      el('button', { type: 'button', text: 'Remove the plan', onclick: () => { ctx.onRemove(); setInfo(null); answer.value = ''; candidate = null; reviewed.checked = false; review.hidden = true; } }));
  }
  return { node, setInfo };
}
