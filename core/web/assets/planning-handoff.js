// Copy-only handoff. Prompts stay in the page and clipboard, never in a chat URL.
import { el, decisionIcon } from './setup-cards.js';
import { CHATS } from './chat-services.js';
export function createPlanningHandoff(ctx) {
  const status = el('p', { class: 'small muted', role: 'status' });
  const prompt = el('textarea', { rows: 12, readonly: true, 'aria-label': ctx.label ?? 'Kickoff prompt', class: 'planning-prompt' });
  const copy = el('button', { type: 'button', class: 'primary', disabled: true }, decisionIcon('file'), el('span', { text: 'Copy prompt' }));
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(prompt.value); status.textContent = 'Prompt copied.'; }
    catch { prompt.focus(); prompt.select(); status.textContent = 'Select and copy the prompt.'; }
  });
  const controls = el('div', { class: 'planning-controls' }, copy);
  if (ctx.chat) {
    const destination = el('select', { 'aria-label': 'Chat service' },
      ...CHATS.map(([name, href]) => el('option', { value: href, text: name })));
    const open = el('a', { target: '_blank', rel: 'noopener noreferrer', class: 'button', href: CHATS[0][1] }, decisionIcon('message'), el('span', { text: 'Open chat' }));
    destination.addEventListener('change', () => { open.href = destination.value; });
    controls.prepend(el('label', {}, 'Use with', destination));
    controls.append(open);
  }
  return build();
  function build() {
    const node = el('div', { class: 'planning-handoff' }, prompt, controls, status);
    return { node, setPrompt(text, message = '') { prompt.value = text; copy.disabled = !text; status.textContent = message; } };
  }
}
