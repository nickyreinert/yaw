import { remoteSettings, requireRemoteEnabled } from '../lib/remote-settings.js';
import { backgroundControl, startServerBackground } from '../remote/background.js';
import { hostRequest } from '../remote/server-client.js';
import { openBrowser, writeLauncher } from '../web/init.js';
import { UsageError } from './commands.js';

export async function host({ values, positionals, io }) {
  requireRemoteEnabled(io.env);
  if (positionals.length || (values.stop && values.foreground)) throw new UsageError('Use yaw host [--foreground | --stop]');
  if (remoteSettings(io.env).role !== 'host') throw new UsageError('Choose Host in Global Settings → Features');
  if (values.stop) { await backgroundControl(io.env, 'stop'); io.stdout.write('Host stopped.\n'); return 0; }
  if (values.foreground) {
    const { startHostServer } = await import('../remote/host.js');
    const service = await startHostServer({ env: io.env, kitRoot: io.kitRoot });
    io.stdout.write(`YAW Host: ${service.address}\nNo idle shutdown. Ctrl+C stops the host and its managed processes.\n`);
    const link = await hostRequest({ env: io.env, local: true, path: '/api/local-open', input: {} });
    await openLink(link.url, io);
    await new Promise((resolve) => service.server.once('close', resolve)); return 0;
  }
  const service = await startServerBackground({ env: io.env, kitRoot: io.kitRoot, cwd: io.cwd });
  const link = await hostRequest({ env: io.env, local: true, path: '/api/local-open', input: {} });
  io.stdout.write(`YAW Host: ${service.address}\nWorkspace: ${remoteSettings(io.env).workspaceRoot}\nRunning in background. Stop with yaw host --stop.\n`);
  await openLink(link.url, io); return 0;
}
export async function openLink(url, io) {
  if (io.openBrowser) return io.openBrowser(url, io.env);
  const launcher = writeLauncher(url);
  const opened = await openBrowser(launcher.file, io.env);
  const timer = setTimeout(() => launcher.remove(), 60000); timer.unref();
  if (!opened) io.stdout.write(`Open this private launcher file: ${launcher.file}\n`);
  return opened;
}
