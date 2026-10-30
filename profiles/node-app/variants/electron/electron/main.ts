import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';

// Main process: one window that loads the built renderer (dist/index.html).
function createWindow(): void {
  const win = new BrowserWindow({ width: 800, height: 600, webPreferences: { contextIsolation: true, sandbox: true } });
  void win.loadFile(join(import.meta.dirname, '..', 'dist', 'index.html'));
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
