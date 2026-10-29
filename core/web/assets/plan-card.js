// One copy-only prompt card for the setup interview, review and saved kickoff.
import { el } from './setup-cards.js';
import { createPlanningHandoff } from './planning-handoff.js';
export { CHATS } from './chat-services.js';
export function createPlanCard(ctx) {
  const id = ctx.id ?? 'plan-card';
  const handoff = createPlanningHandoff(ctx);
  const node = el('section', { class: 'plan-card', id, tabindex: -1, 'aria-labelledby': `${id}-title` },
    el('h3', { id: `${id}-title`, text: ctx.title ?? 'Kickoff prompt' }),
    ctx.instruction ? el('p', { class: 'small muted', text: ctx.instruction }) : null, handoff.node);
  if (ctx.prompt) handoff.setPrompt(ctx.prompt);
  return { node, setPrompt: handoff.setPrompt };
}
