const copyButton = document.querySelector('#copy');
const installCommand = document.querySelector('#install-command');

copyButton?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(installCommand.textContent.trim());
    copyButton.textContent = 'Copied!';
    setTimeout(() => { copyButton.textContent = 'Copy'; }, 2000);
  } catch {
    copyButton.textContent = 'Select command';
  }
});

const fin = document.querySelector('#fin');
const moveFin = () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  const ratio = max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 0;
  fin.style.left = `calc(${ratio * 100}% - ${ratio * 24}px)`;
};
addEventListener('scroll', moveFin, { passive: true });
addEventListener('resize', moveFin);
moveFin();
