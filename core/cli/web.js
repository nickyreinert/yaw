// `yaw web` (#172): the local web interface. In a YAW project it opens the read-only dashboard; in a folder
// without YAW it opens the setup form (same as `yaw init --web`).

import { readManifest } from '../render/manifest.js';
import { startDashboard } from '../web/dashboard.js';
import { initWeb, openBrowser, writeLauncher } from '../web/init.js';
import { UsageError } from './commands.js';
import { verifyProject } from './init.js';

export async function web({ positionals, io }) {
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  if (!readManifest(io.cwd)) {
    io.stdout.write('No YAW setup in this folder yet, so yaw web opens the setup form (same as yaw init --web).\n');
    return initWeb({ io, verify: verifyProject });
  }
  let finish;
  const done = new Promise((r) => { finish = r; });
  let launcher;
  const server = await startDashboard({ root: io.cwd, kitRoot: io.kitRoot, env: io.env, onClose: () => { launcher?.remove(); finish(0); } });
  io.stdout.write(`YAW dashboard (local only, read-only). Open this one-time link:\n${server.url}\nCtrl+C stops the server; it also stops after 30 minutes without use.\n`);
  let opened;
  if (io.openBrowser) opened = await io.openBrowser(server.url, io.env);
  else {
    launcher = writeLauncher(server.url);
    opened = await openBrowser(launcher.file, io.env);
  }
  if (!opened) io.stdout.write('Browser could not be opened automatically; open the link above manually.\n');
  return done;
}
