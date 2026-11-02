// Runs when the toolbar popup opens. Extension pages may not use inline scripts or remote code.
// Firefox also provides the chrome.* namespace, so one script serves both engines.
document.querySelector('#version').textContent = chrome.runtime.getManifest().version;
