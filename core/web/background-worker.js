import { unlinkSync } from 'node:fs';
import { readManifest } from '../render/manifest.js';
import { verifyProject } from '../cli/init.js';
import { startDashboard } from './dashboard.js';
import { createFormApi } from './init.js';
import { startFormServer } from './form-server.js';
import { writeState } from './background.js';

let ready = false;
let server;
process.once('disconnect', () => {
  if (!ready) server?.close();
});

process.once('message', async ({ root, kitRoot, file, controlToken }) => {
  const remove = () => {
    for (const path of [`${file}.html`, file]) { // the state file last: once it is gone, cleanup is complete
      try { unlinkSync(path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  };
  const start = async (port = 0) => {
    const options = { port, idleMs: 0, controlToken };
    if (readManifest(root)) {
      server = await startDashboard({ root, kitRoot, env: process.env, ...options, onClose: remove });
    } else {
      let applied = false;
      const api = createFormApi({ root, kitRoot, env: process.env, verify: verifyProject, stderr: process.stderr });
      const apply = api.apply;
      api.apply = async (...args) => {
        try { return await apply(...args); }
        finally { applied = Boolean(readManifest(root)); }
      };
      server = await startFormServer({
        ...options, api,
        onClose: () => {
          if (applied) start(server.port).catch((e) => { remove(); console.error(`yaw web background: ${e.message}`); process.exitCode = 1; });
          else remove();
        },
      });
    }
    writeState(file, { port: server.port, controlToken });
    return server;
  };
  try {
    await start();
    if (!process.connected) {
      await server.close();
      return;
    }
    process.send({ url: server.url }, (error) => {
      if (error) server.close();
      else ready = true;
    });
  } catch (e) {
    await server?.close();
    remove();
    if (process.connected) process.send({ error: `Could not start background web server: ${e.message}` }, () => process.disconnect());
    process.exitCode = 1;
  }
});
