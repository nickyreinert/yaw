import { mountInterview } from './interview-view.js';

export async function hostedInterview({ root, context, bootstrap, request, onDone }) {
  const shell = await fetch('/interview-shell.html');
  root.innerHTML = await shell.text(); // Bundled static template; all user data uses textContent.
  context.textContent = `yaw ${bootstrap.hosted.command} · ${bootstrap.hosted.slug} · ${bootstrap.hosted.workspaceRoot}`;
  return mountInterview(root, { bootstrap, persistent: true, onDone,
    request: async (action, input) => {
      const value = await request(action, input);
      if (value.destination) context.textContent = `yaw ${bootstrap.hosted.command} · ${value.destination}`;
      if (action === 'apply') {
        return new Response([JSON.stringify({ type: 'log', text: `${value.project.path}\n${value.message}\n` }), JSON.stringify({ type: 'done', ok: value.ok, message: value.message })].join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
      }
      return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    },
  });
}
