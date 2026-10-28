import { readFileSync } from 'node:fs';
export function interviewShell() {
  const source = readFileSync(new URL('./assets/index.html', import.meta.url), 'utf8');
  const start = source.indexOf('<section data-view="setup"');
  const end = source.indexOf('<section data-view="global"', start);
  const dialogs = source.slice(source.indexOf('<dialog id="save-dialog"'), source.indexOf('<noscript>'));
  return source.slice(start, end).replace('<h1 tabindex="-1">Interview</h1>', '<h2 tabindex="-1">Interview</h2>').replace('data-view="setup" class="view" hidden', 'class="interview-shared"') + dialogs;
}
