import { mountInterview } from './interview-view.js';
import { showView, startWorkspace, setInterviewDone } from './workspace.js';
import { kickoffCard } from './settings-view.js';
startWorkspace();
mountInterview(document, { navigate: showView, onDone: setInterviewDone, kickoffCard }).catch((error) => {
  document.getElementById('error').textContent = error.message;
  document.getElementById('error').hidden = false;
});
