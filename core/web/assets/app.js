import { mountInterview } from './interview-view.js';
import { showView, startWorkspace, setInterviewDone } from './workspace.js';
import { kickoffCard } from './settings-view.js';
const loading = document.getElementById('setup-loading');
const stage = document.getElementById('setup-loading-stage');

async function start() {
  await mountInterview(document, {
    navigate: showView, onDone: setInterviewDone, kickoffCard,
    onInitialPreview: () => { stage.textContent = 'Preparing the file preview…'; },
  });
  await startWorkspace();
  for (const node of document.querySelectorAll('.skip, .sidebar, .workspace')) node.hidden = false;
  loading.hidden = true;
  document.querySelector('.view:not([hidden]) h1')?.focus({ preventScroll: true });
}

start().catch((error) => {
  document.getElementById('setup-loading-title').textContent = 'Could not open setup';
  stage.hidden = true;
  loading.querySelector('progress').hidden = true;
  const message = document.getElementById('setup-loading-error');
  message.textContent = error.message;
  message.hidden = false;
  document.getElementById('setup-retry').hidden = false;
});
