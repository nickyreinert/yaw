import { readFileSync } from 'node:fs';
import { startFormServer } from './form-server.js';
import { HOST_ASSETS } from '../remote/host.js';
import { hostRequest } from '../remote/server-client.js';
import { remoteSettings } from '../lib/remote-settings.js';
import { FormError } from './form-model.js';
import { openLink } from '../cli/host.js';

export async function hostedWeb({ io, command, local, id, skipVerify = false }) {
  const request = (path, input) => hostRequest({ env: io.env, path, input, local });
  if (local) {
    // Host interviews use the already-running host interface, never a temporary local init form.
    const link = await request('/api/local-open', {}); await openLink(`${link.url}${id ? `#interview=${id}` : skipVerify ? '#skip-verify=1' : ''}`, io); return 0;
  }
  let finish, result = 0;
  const done = new Promise((resolve) => { finish = resolve; });
  const assets = new Map(HOST_ASSETS);
  assets.set('/hosted-client.js', ['text/javascript', readFileSync(new URL('./assets/hosted-client.js', import.meta.url))]);
  const page = (csrf) => readFileSync(new URL('./assets/hosted-client.html', import.meta.url), 'utf8').replace('YAW_CSRF', csrf);
  const allowed = new Set(id ? [id] : []);
  const api = {
    bootstrap: () => ({ id, address: remoteSettings(io.env).address }),
    actions: ['hosted-start', 'hosted-bootstrap', 'hosted-action'],
    async action(name, input) {
      try {
        if (name === 'hosted-start') { const s = await request('/api/interviews', { slug: input.slug, command, skipVerify }); allowed.add(s.id); return s; }
        if (!allowed.has(input.id)) throw new FormError('Unknown local interview', 404);
        if (name === 'hosted-bootstrap') return request(`/api/interviews/${input.id}/bootstrap`);
        if (!['preview', 'diff', 'draft', 'preset', 'prefill', 'apply', 'kickoff-prompt', 'kickoff-reply', 'file-preview'].includes(input.action)) throw new FormError('Unknown interview action', 404);
        const value = await request(`/api/interviews/${input.id}/${input.action}`, input.input);
        if (input.action === 'apply') { result = value.ok ? 0 : 1; const timer = setTimeout(() => server.close(), 1500); timer.unref(); }
        return value;
      } catch (e) { throw new FormError(e.status ? e.message : 'Host request failed; inspect the host before retrying', e.status ?? 500); }
    },
  };
  const server = await startFormServer({ api, page, assets, onClose: () => finish(result) });
  io.stdout.write(`yaw init-remote · ${remoteSettings(io.env).address}\nOpening the client interview. Ctrl+C closes this client UI.\n`);
  await openLink(server.url, io); return done;
}
