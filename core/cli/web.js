// `yaw web` (#172): the local web interface. In a YAW project it opens the read-only dashboard; in a folder
// without YAW it opens the setup form (same as `yaw init --web`).

import { readManifest } from '../render/manifest.js';
import { startDashboard } from '../web/dashboard.js';
import { initWeb, openBrowser, writeLauncher } from '../web/init.js';
import { UsageError } from './commands.js';
import { verifyProject } from './init.js';
import { guardFolder } from './folder-guard.js';
import { backgroundRequest, startBackground, writeBackgroundLauncher } from '../web/background.js';

async function openBackground(result, io) {
  io.stdout.write(`YAW web is running in the background (local only).\n${result.url}\nRun yaw web in this folder to reopen it, or yaw web --stop to stop it. No idle shutdown.\n`);
  let opened;
  if (io.openBrowser) opened = await io.openBrowser(result.url, io.env);
  else {
    opened = await openBrowser(writeBackgroundLauncher({ root: io.cwd, env: io.env, url: result.url }), io.env);
  }
  if (!opened) io.stdout.write('Browser could not be opened automatically; open the link above manually.\n');
  return 0;
}

export async function web({ values = {}, positionals, io }) {
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  if (values.background && values.stop) throw new UsageError('use either --background or --stop');
  const existing = await backgroundRequest({ root: io.cwd, env: io.env, action: values.stop ? 'stop' : 'open' });
  if (values.stop) {
    io.stdout.write(existing && !existing.stale ? 'Background web server stopped.\n' : existing?.stale ? 'Removed stale background web state; the server was no longer running.\n' : 'No background web server is running for this folder.\n');
    return 0;
  }
  if (existing?.stale) io.stdout.write('The previous background web server is no longer running; removed its stale state.\n');
  else if (existing) return openBackground(existing, io);
  if (!readManifest(io.cwd)) {
    io.stdout.write('No YAW setup in this folder yet, so yaw web opens the setup form (same as yaw init --web).\n');
    if (!(await guardFolder({ root: io.cwd, io, force: values.force }))) {
      io.stdout.write('cancelled; nothing was written\n');
      return 1;
    }
    if (!values.background) return initWeb({ io, verify: verifyProject });
  }
  if (values.background) return openBackground(await startBackground({ io }), io);
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
