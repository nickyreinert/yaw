// Reviewed instruction additions (preview and apply). Nothing from a review is stored. No transcript discovery here.
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent, writeAtomic } from '../render/files.js';
import { effectivePrompt, promptLayers, savePrompt } from '../../modules/review/lib/prompts.js';
import { loadRules, secretValueRule } from '../../modules/security/lib/guards.js';
import { fullFileDiff } from '../web/form-model.js';

const TARGETS = ['project-instructions', 'project-review-rules', 'personal-review-rules'];
export class ImproveError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const safe = (text, kitRoot, max = 32000) => {
  if (typeof text !== 'string' || !text.trim() || text.length > max || text.includes('\0') || secretValueRule(loadRules({ kitRoot }), text)) throw new ImproveError('Text is empty, too large or looks like it contains a secret.');
  return text.trim();
};
// Read only the fixed AGENTS.md target, never symlinks or arbitrary browser-supplied paths.
function instructions(root, kitRoot) {
  const path = join(root, 'AGENTS.md');
  let st;
  try { st = lstatSync(path); } catch (e) { if (e.code === 'ENOENT') throw new ImproveError('This project has no AGENTS.md. Initialize it first.'); throw e; }
  if (!st.isFile() || st.isSymbolicLink() || st.size > 32000) throw new ImproveError('AGENTS.md must be a regular file of at most 32,000 bytes.');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = fstatSync(fd);
    if (actual.ino !== st.ino || actual.dev !== st.dev || !actual.isFile() || actual.size > 32000) throw new ImproveError('AGENTS.md changed while reading.');
    const text = readFileSync(fd, 'utf8'); safe(text, kitRoot); return text;
  } finally { closeSync(fd); }
}
export function previewImprovement({ root, env, kitRoot, input }) {
  if (!TARGETS.includes(input.target)) throw new ImproveError('Choose project instructions, project review rules or personal review rules.');
  const snippet = safe(input.instruction, kitRoot, 4000);
  if (/<!--\s*\/?(?:yaw|improvement):/i.test(snippet)) throw new ImproveError('An instruction addition cannot contain management markers.');
  const project = input.target === 'project-instructions';
  const scope = input.target === 'personal-review-rules' ? 'global' : 'project';
  const current = project ? instructions(root, kitRoot) : effectivePrompt('rules', { root: scope === 'project' ? root : null, env, kitRoot }).text;
  const layerExpected = project ? null : promptLayers('rules', { root: scope === 'project' ? root : null, env, kitRoot })[scope === 'global' ? 'global' : 'project']?.hash ?? null;
  const path = project ? 'AGENTS.md' : scope === 'global' ? '~/.yaw/review/rules.md' : '.yaw/review/rules.md';
  const addition = `\n\n## Reviewed improvement\n\n${snippet}\n`;
  const after = current + addition;
  if (project && after.trimEnd().split('\n').length > 90) throw new ImproveError('This addition exceeds the AGENTS.md 90-line budget. Shorten it or choose review rules.');
  safe(after, kitRoot);
  return { target: input.target, path, instruction: snippet, layerExpected, expected: hashContent(current), afterHash: hashContent(after), diff: fullFileDiff(path, current, after) };
}
export function applyImprovement({ root, env, kitRoot, input }) {
  if (input.confirm !== true) throw new ImproveError('Review the exact instruction diff and confirm applying it.');
  const preview = previewImprovement({ root, env, kitRoot, input });
  if (input.expected !== preview.expected || input.afterHash !== preview.afterHash) throw new ImproveError('Instructions or the proposed addition changed; preview again.', 409);
  const project = input.target === 'project-instructions';
  if (project) {
    const current = instructions(root, kitRoot);
    if (hashContent(current) !== preview.expected) throw new ImproveError('Instructions changed; preview again.', 409);
    writeAtomic(root, 'AGENTS.md', `${current}\n\n## Reviewed improvement\n\n${preview.instruction}\n`);
  } else {
    const scope = input.target === 'personal-review-rules' ? 'global' : 'project';
    const text = effectivePrompt('rules', { root: scope === 'project' ? root : null, env, kitRoot }).text;
    if (hashContent(text) !== preview.expected) throw new ImproveError('Reviewer rules changed; preview again.', 409);
    savePrompt({ root, env, kitRoot, scope, kind: 'rules', expected: preview.layerExpected, text: `${text}\n\n## Reviewed improvement\n\n${preview.instruction}\n` });
  }
  return { message: `Applied the reviewed addition to ${preview.path}.`, ...preview };
}
