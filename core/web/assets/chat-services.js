// Shared browser chat destinations. Prompts are copied deliberately, never embedded in URLs.
export const CHATS = [
  ['ChatGPT', 'https://chatgpt.com/'],
  ['Claude', 'https://claude.ai/new'],
  ['Gemini', 'https://gemini.google.com/app'],
  ['Microsoft Copilot', 'https://copilot.microsoft.com/'],
  ['Grok', 'https://grok.com/'],
  ['DeepSeek', 'https://chat.deepseek.com/'],
  ['Qwen', 'https://chat.qwen.ai/'],
  ['Mistral Le Chat', 'https://chat.mistral.ai/chat'],
  ['Perplexity', 'https://www.perplexity.ai/'],
  ['Kimi', 'https://www.kimi.com/'],
  ['GLM (Z.ai)', 'https://chat.z.ai/'],
  ['Meta AI', 'https://www.meta.ai/'],
];

// Reused by setup planning and the saved kickoff prompt; links carry no project data.
export function chatLinks() {
  const links = document.createElement('div');
  links.className = 'chat-links'; links.setAttribute('role', 'group'); links.setAttribute('aria-label', 'Open an AI chat');
  for (const [name, href] of CHATS) {
    const link = document.createElement('a');
    link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'chip'; link.textContent = `${name} ↗`;
    links.append(link);
  }
  return links;
}
