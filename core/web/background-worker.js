import { unlinkSync } from 'node:fs';
import { startDashboard } from './dashboard.js';
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
    server = await startDashboard({ root, kitRoot, env: process.env, ...options, onClose: remove });
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
