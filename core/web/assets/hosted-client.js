import { hostedInterview } from './host-interview.js';
const $ = (id) => document.getElementById(id), csrf = document.querySelector('meta[name=yaw-csrf]').content;
let config;
async function post(action, input) {
  const r = await fetch(`/api/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yaw-token': csrf }, body: JSON.stringify(input) });
  const value = await r.json(); if (!r.ok) throw new Error(value.error ?? 'Host request failed'); return value;
}
async function open(id) {
  const bootstrap = await post('hosted-bootstrap', { id }); $('start').hidden = true;
  await hostedInterview({ root: $('interview'), context: $('interview-context'), bootstrap, request: (action, input) => post('hosted-action', { id, action, input }) });
}
$('start').addEventListener('submit', async (e) => { e.preventDefault(); try { const value = await post('hosted-start', { slug: $('slug').value }); await open(value.id); } catch (e) { $('notice').textContent = e.message; } });
fetch('/api/bootstrap').then((r) => r.json()).then(async (value) => { config = value; $('destination').textContent = config.address; if (config.id) await open(config.id); }).catch((e) => { $('notice').textContent = e.message; });
