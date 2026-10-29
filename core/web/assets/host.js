import { hostedInterview } from './host-interview.js';
const $ = (id) => document.getElementById(id);
const csrf = document.querySelector('meta[name=yaw-csrf]').content;
let interview;
const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
async function request(path, input) {
  const r = await fetch(path, { ...(input === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'x-yaw-token': csrf }, body: JSON.stringify(input) }) });
  const value = await r.json(); if (!r.ok) throw new Error(value.error ?? 'Host request failed'); return value;
}
const report = (e) => { $('notice').textContent = e.message; };
const button = (text, fn) => { const b = node('button', text); b.type = 'button'; b.addEventListener('click', () => Promise.resolve().then(fn).catch(report)); return b; };
function rows(id, entries, render) { $(id).replaceChildren(...(entries.length ? entries.map(render) : [node('p', 'None')])); }
function row(text, ...controls) { const r = node('div', ''); r.className = 'host-row'; r.append(node('span', text), ...controls); return r; }
async function openInterview(id) {
  const bootstrap = await request(`/api/interviews/${id}/bootstrap`);
  interview?.destroy(); $('host-interview').hidden = false;
  interview = await hostedInterview({ root: $('interview'), context: $('interview-context'), bootstrap, request: (action, input) => request(`/api/interviews/${id}/${action}`, input), onDone: () => refresh().catch(report) });
}
async function refresh() {
  const s = await request('/api/state'); $('host-root').textContent = s.root;
  rows('projects', s.projects, (p) => row(`${p.slug ?? p.id} · ${p.language ?? ''} · ${p.state ?? 'registered'}`));
  rows('sessions', s.sessions, (s) => {
    const controls = [];
    if (s.url) { const a = node('a', 'Open Claude'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; controls.push(a); }
    if (s.startup) controls.push(button(s.startup === 'workspace' ? 'Trust workspace' : 'Enable Claude Remote Control', async () => { await request('/api/native-confirm', { session: s.id }); await refresh(); }));
    if (['starting', 'ready', 'busy', 'idle', 'input-required', 'confirmation-required', 'setup-required'].includes(s.state)) controls.push(button('Stop', async () => { await request('/api/native-stop', { session: s.id }); await refresh(); }));
    return row(`${s.slug} · ${s.state}`, ...controls);
  });
  rows('pending', s.pending, (p) => row(`${p.name} · ${p.verification}`, button('Approve sync + init', async () => { await request('/api/pair/approve', { id: p.id }); await refresh(); })));
  rows('devices', s.devices, (d) => row(`${d.name}${d.revoked ? ' · revoked' : ''}`, ...(d.revoked ? [] : [button('Revoke', async () => { await request('/api/revoke', { id: d.id }); await refresh(); })])));
  $('telegram-status').textContent = s.telegram.configured ? `${s.telegram.status} · ${s.telegram.paired ? 'paired' : 'unpaired'}` : 'Bot credential required on host';
  $('telegram-pair').disabled = !s.telegram.configured; $('telegram-revoke').disabled = !s.telegram.paired;
  $('sync-status').textContent = `${s.sync.status}${s.sync.revision ? ` · revision ${s.sync.revision}` : ''}`;
  $('sync-conflicts').hidden = s.sync.status !== 'conflict';
}
$('new-project').addEventListener('submit', async (e) => { e.preventDefault(); try { const s = await request('/api/interviews', { slug: $('slug').value, command: 'init-local', skipVerify: new URLSearchParams(location.hash.slice(1)).get('skip-verify') === '1' }); history.replaceState(null, '', `#interview=${s.id}`); await openInterview(s.id); } catch (e) { report(e); } });
$('refresh').addEventListener('click', () => refresh().catch(report));
$('logout').addEventListener('click', () => request('/api/logout', {}).then(() => location.reload()).catch(report));
$('telegram-pair').addEventListener('click', async () => { try { const value = await request('/api/telegram-pair', {}); const a = node('a', 'Open Telegram to pair'); a.href = value.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; $('telegram-link').replaceChildren(a); } catch (e) { report(e); } });
$('telegram-revoke').addEventListener('click', () => request('/api/telegram-revoke', {}).then(refresh).catch(report));
for (const resolve of ['local', 'remote']) $(`sync-${resolve}`).addEventListener('click', () => request('/api/sync', { resolve }).then(refresh).catch(report));
refresh().then(() => { const id = new URLSearchParams(location.hash.slice(1)).get('interview'); if (id) return openInterview(id); }).catch(report);
setInterval(() => { if (!document.hidden) refresh().catch(report); }, 3000);
