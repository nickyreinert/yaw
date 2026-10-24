const copyButton = document.querySelector('#copy');
const installCommand = document.querySelector('#install-command');

copyButton?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(installCommand.textContent.trim());
    copyButton.textContent = 'Copied!';
    setTimeout(() => { copyButton.textContent = 'Copy'; }, 2000);
  } catch {
    copyButton.textContent = 'Select command';
    installCommand.parentElement.focus();
  }
});
