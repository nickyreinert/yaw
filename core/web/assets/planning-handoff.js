// Shared delivery controls for early setup and later planning. No prompt is placed in a URL.
import { el } from './setup-cards.js';
import { CHATS } from './chat-services.js';
export function createPlanningHandoff(ctx) {
  const status = el('p', { class: 'small muted', role: 'status' });
  const prompt = el('textarea', { rows: 12, maxlength: 100000, 'aria-label': 'Planning prompt', class: 'planning-prompt' });
  const destination = el('select', { 'aria-label': 'Planning destination' });
  const browser = el('optgroup', { label: 'Web chats' });
  for (const [name] of CHATS) browser.append(el('option', { value: `browser:${name}`, text: name }));
  const installed = el('optgroup', { label: 'Coding agents on this computer' });
  destination.append(browser, installed, el('option', { value: 'manual', text: 'Other chat or local model' }));
  const open = el('a', { text: 'Open chat ↗', target: '_blank', rel: 'noopener noreferrer', class: 'button' });
  const stop = el('button', { type: 'button', text: 'Stop drafting', hidden: true });
  const run = el('button', { type: 'button', text: 'Draft with coding agent', class: 'primary', hidden: true });
  let edited = false, source = '', job = null, running = false;
  prompt.addEventListener('input', () => { edited = true; });
  const json = async (action, input = {}) => (await ctx.request(action, input)).json();
  async function loadPrompt(force = false) {
    const current = await ctx.getPrompt();
    if (!edited || force || !prompt.value) { prompt.value = current; source = current; edited = false; }
    else if (source !== current) status.textContent = 'Project answers changed · Refresh prompt';
    return prompt.value;
  }
  const preview = el('details', { class: 'planning-preview' }, el('summary', { text: 'Preview and edit prompt' }), prompt,
    el('button', { type: 'button', text: 'Refresh from project answers', onclick: () => loadPrompt(true).catch(fail) }));
  const fail = (error) => { status.textContent = error.message || 'Planning action failed.'; };
  const copy = el('button', { type: 'button', text: 'Copy prompt', class: 'primary', onclick: async () => {
    try { await navigator.clipboard.writeText(await loadPrompt()); status.textContent = 'Prompt copied.'; } catch (e) { fail(e); preview.open = true; }
  } });
  const help = el('p', { class: 'small muted' });
  function target() {
    const chat = CHATS.find(([name]) => destination.value === `browser:${name}`);
    open.hidden = !chat; if (chat) open.href = chat[1];
    run.hidden = !destination.value.startsWith('cli:'); run.disabled = Boolean(ctx.offline) || running;
    help.hidden = !destination.value.startsWith('cli:');
    help.textContent = ctx.offline ? 'Offline · Copy prompt' : 'Provider billing · Tools off';
  }
  destination.addEventListener('change', target); target();
  function agents(list) {
    installed.replaceChildren(...list.map((agent) => el('option', { value: `cli:${agent.id}`, text: `${agent.name}${agent.installed ? '' : ' (not available)'}`, disabled: !agent.installed })));
  }
  agents(ctx.agents ?? []);
  const controls = el('div', { class: 'planning-controls' }, el('label', {}, 'Use with', destination), copy, open, run, stop);
  const steps = el('div', { class: 'planning-steps' },
    el('div', {}, controls, help, preview),
    el('div', {}, el('strong', { text: 'Reply' }), ctx.reply));
  const node = el('div', { class: 'planning-handoff' }, steps, status);
  async function clear() { if (job) await json('planning-clear', { id: job.id }); job = null; }
  stop.addEventListener('click', () => clear().catch(fail));
  run.addEventListener('click', async () => {
    try {
      run.disabled = true;
      await loadPrompt();
      if (!preview.open) { preview.open = true; status.textContent = 'Review prompt before drafting.'; return; }
      const name = destination.selectedOptions[0].textContent;
      if (!confirm(`Send the inspected prompt to ${name} using its signed-in provider? Provider charges may apply. The agent drafts text with tools disabled; it cannot edit this project.`)) return;
      job = await json('planning-start', { agent: destination.value.slice(4), prompt: prompt.value, confirm: true });
      running = true; destination.disabled = true; prompt.disabled = true; run.disabled = true; stop.hidden = false; ctx.busy?.(true);
      while (job?.status === 'running') {
        status.textContent = job.message;
        await new Promise((resolve) => setTimeout(resolve, 700));
        if (!node.isConnected || node.closest('[hidden]') || !node.getClientRects().length) { await clear(); return; }
        const next = await json('planning-job');
        if (!job || next?.id !== job.id) break;
        job = next;
      }
      if (job?.status === 'completed') ctx.onReply(job.output);
      status.textContent = job?.message ?? 'Drafting stopped.';
    } catch (e) { fail(e); }
    finally { running = false; destination.disabled = false; prompt.disabled = false; stop.hidden = true; ctx.busy?.(false); target(); }
  });
  let loaded = false;
  return { node, async load() {
    await loadPrompt();
    if (!loaded && !ctx.offline) { loaded = true; try { agents((await json('planning-agents')).agents); } catch (e) { fail(e); } }
  } };
}
