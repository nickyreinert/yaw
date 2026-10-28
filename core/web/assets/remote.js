const $ = (id) => document.getElementById(id);
let csrf = '', state, selected = null, epoch, after = 0, refreshing = false;
const unacknowledged = new Map();
const notice = (text) => { $('notice').textContent = text; };
const node = (tag, text, className) => { const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; return n; };
async function api(path, input) {
  const response = await fetch(`/api/${path}`, { method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-yaw-token': csrf }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401) { $('workspace').hidden = true; $('login').hidden = false; } const e = new Error(data.error); e.status = response.status; throw e; }
  return data;
}
const act = (fn) => async (event) => { event?.preventDefault(); try { await fn(); notice(''); } catch (e) { notice(e.message); } };
function choose(id) {
  selected = id; epoch = undefined; after = 0; $('messages').replaceChildren(); $('decisions').replaceChildren(); refresh().catch((e) => notice(e.message));
}
function message(text, role = 'notice') {
  $('messages').append(node('article', text, `message ${role}`));
  while ($('messages').children.length > 200) $('messages').firstChild.remove();
  $('messages').scrollTop = $('messages').scrollHeight;
}
async function command(action, extra = {}) {
  const payload = { action, session: selected, ...extra }, signature = JSON.stringify(payload);
  const input = unacknowledged.get(signature) ?? { commandId: crypto.randomUUID(), ...payload };
  if (unacknowledged.size >= 20 && !unacknowledged.has(signature)) throw new Error('Several commands have uncertain delivery. Inspect their sessions before continuing.');
  unacknowledged.set(signature, input);
  let receipt;
  try { receipt = await api('command', input); unacknowledged.delete(signature); }
  catch (e) { if (e.status >= 400 && e.status < 500) unacknowledged.delete(signature); throw e; }
  if (receipt.status === 'unknown') throw new Error('Delivery is unknown. Inspect the checkout and provider history before resending.');
  if (action === 'new') choose(receipt.session);
  $('prompt').value = ''; await refresh();
}
function decisions(items) {
  const current = new Map([...$('decisions').children].map((n) => [n.dataset.id, n]));
  for (const d of items) {
    if (current.has(d.requestId)) { current.delete(d.requestId); continue; }
    const card = node('section', '', 'decision'); card.dataset.id = d.requestId;
    card.append(node('h3', `${d.details.kind === 'question' ? 'Input requested' : 'Approval requested'} · ${d.details.tool}`),
      node('p', `This request applies once to session ${d.session}, turn ${d.turn}. Expires ${new Date(d.expires).toLocaleTimeString()}.`));
    if (d.details.kind === 'question') {
      const fields = [];
      for (const q of d.details.input?.questions ?? []) {
        const label = node('label', q.question), input = document.createElement('textarea'); input.rows = 2; label.append(input); card.append(label);
        fields.push({ key: q.id ?? q.question, input });
        const choices = node('div', '', 'actions');
        for (const option of q.options ?? []) {
          const choice = node('button', option.label); choice.title = option.description ?? '';
          choice.onclick = () => { input.value = q.multiSelect && input.value ? `${input.value}, ${option.label}` : option.label; }; choices.append(choice);
        }
        card.append(choices);
      }
      if (fields.length) {
        const answer = node('button', 'Send answers');
        answer.onclick = act(async () => {
          if (fields.some((f) => !f.input.value.trim())) throw new Error('Answer each question before sending.');
          await command('answer', { session: d.session, requestId: d.requestId, answers: Object.fromEntries(fields.map((f) => [f.key, f.input.value])) });
        }); card.append(answer);
      } else card.append(node('p', 'Question details are unavailable. Deny this request and send a normal message.'));
    } else {
      card.append(node('pre', JSON.stringify(d.details.input, null, 2)));
      const allow = node('button', 'Allow this action once'); allow.onclick = act(() => command('approve', { session: d.session, requestId: d.requestId })); card.append(allow);
    }
    const deny = node('button', 'Deny'); deny.onclick = act(() => command('deny', { session: d.session, requestId: d.requestId })); card.append(deny); $('decisions').append(card);
  }
  for (const n of current.values()) n.remove();
}
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    state = await api('state'); csrf = state.csrf;
    $('login').hidden = true; $('workspace').hidden = false; $('logout').hidden = false;
    const previousProject = $('project').value, previousAgent = $('agent').value;
    $('project').replaceChildren(...state.projects.map((p) => { const option = node('option', p.name); option.value = p.id; return option; }));
    if (state.projects.some((p) => p.id === previousProject)) $('project').value = previousProject;
    $('agent').replaceChildren(...state.adapters.map((a) => { const option = node('option', `${a.id}${a.available === false ? ' (setup required)' : ''}`); option.value = a.id; option.title = a.requirement ?? ''; return option; }));
    if (state.adapters.some((a) => a.id === previousAgent)) $('agent').value = previousAgent;
    $('sessions').replaceChildren(...state.sessions.slice().reverse().map((s) => {
      const project = state.projects.find((p) => p.id === s.project), b = node('button', `${project?.name ?? 'Project'} · ${s.agent}\n${s.state} · ${s.id.slice(0, 8)}`, s.id === selected ? 'selected' : ''); b.onclick = () => choose(s.id); return b;
    }));
    const s = state.sessions.find((s) => s.id === selected), busy = s && ['starting', 'running', 'waiting-input', 'waiting-approval', 'interrupting'].includes(s.state);
    $('new-options').hidden = Boolean(s); $('session-title').textContent = s ? `${s.agent} · ${s.id.slice(0, 8)}` : 'New session'; $('session-state').textContent = s?.state ?? 'Ready';
    $('send').textContent = s ? 'Send message' : 'Start session'; $('send').disabled = Boolean(busy || (s && !s.controllable) || (!s && !state.projects.length));
    $('resume').hidden = !s || s.controllable || !s.providerSession; $('interrupt').hidden = !busy || !s?.controllable; $('stop').hidden = !s || s.state === 'stopped';
    $('projects-list').replaceChildren(...state.projects.map((p) => node('p', `${p.name} · ${p.id}\n${p.path}`)));
    $('devices-list').replaceChildren(...state.devices.map((d) => { const row = node('p', `${d.name} · ${d.revoked ? 'revoked' : 'paired'} `); if (!d.revoked) { const b = node('button', 'Revoke'); b.onclick = act(async () => { await api('revoke', { id: d.id }); await refresh(); }); row.append(b); } return row; }));
    $('hub-revision').textContent = `Hub schema ${state.hub.schema} · revision ${state.hub.revision}`;
    $('telegram-status').textContent = `${state.telegram.status} · ${state.telegram.paired ? `paired to ${state.telegram.paired.userId}` : 'not paired'}`;
    if (s) {
      const data = await api(`events?session=${encodeURIComponent(s.id)}&after=${after}${epoch ? `&epoch=${encodeURIComponent(epoch)}` : ''}`);
      if (data.gap) message('Live output has a gap. Earlier content is unavailable; inspect native provider history on the server.');
      epoch = data.epoch;
      for (const e of data.events) { after = Math.max(after, e.sequence); if (e.type === 'message') message(e.text, e.role); if (['activity', 'files', 'notice'].includes(e.type)) message(e.text, e.type === 'notice' ? 'notice' : 'activity'); }
      decisions(data.decisions);
    }
  } finally { refreshing = false; }
}
$('login-form').onsubmit = act(async () => { const r = await api('login', { token: $('owner-token').value }); $('owner-token').value = ''; csrf = r.csrf; await refresh(); });
$('logout').onclick = act(async () => { await api('logout', {}); csrf = ''; location.reload(); });
$('new-session').onclick = () => choose(null);
$('settings-toggle').onclick = () => { $('settings').hidden = !$('settings').hidden; };
$('prompt-form').onsubmit = act(async () => {
  $('send').disabled = true;
  try { await command(selected ? 'send' : 'new', selected ? { prompt: $('prompt').value } : { project: $('project').value, agent: $('agent').value, prompt: $('prompt').value, ...($('model').value ? { model: $('model').value } : {}) }); }
  finally { await refresh(); }
});
$('resume').onclick = act(() => command('resume', { prompt: $('prompt').value }));
$('interrupt').onclick = act(() => command('interrupt'));
$('stop').onclick = act(() => command('stop'));
$('project-form').onsubmit = act(async () => { await api('project', { path: $('project-path').value }); $('project-path').value = ''; await refresh(); });
$('device-form').onsubmit = act(async () => { const d = await api('device', { name: $('device-name').value }); $('device-secret').textContent = `Copy this credential now; it will not be shown again:\n${d.token}`; await refresh(); });
$('import-vault').onclick = act(async () => { const f = $('vault-file').files[0]; if (!f || f.size > 16 * 1024 * 1024) throw new Error('Choose a portable vault smaller than 16 MiB.'); await api('import', { vault: JSON.parse(await f.text()) }); await refresh(); });
$('telegram-form').onsubmit = act(async () => { await api('telegram', { userId: $('telegram-user').value, chatId: $('telegram-chat').value }); await refresh(); });
$('telegram-clear').onclick = act(async () => { await api('telegram', { clear: true }); await refresh(); });
refresh().catch(() => {});
setInterval(() => { if (csrf && !document.hidden) refresh().catch((e) => notice(e.message)); }, 2000);
