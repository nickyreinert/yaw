// Review prompts in the dashboard (ADR-0056): the workspace Settings tab edits the project's overrides, the
// Global Settings tab edits the user's blueprint. The store and its checks live in the review module.

import { readManifest } from '../render/manifest.js';
import { enabledModules } from '../render/project.js';
import { FormError } from './form-model.js';
import { PromptError, allPrompts, removePrompt, savePrompt } from '../../modules/review/lib/prompts.js';

const asForm = (fn) => {
  try { return fn(); } catch (e) {
    if (e instanceof PromptError) throw new FormError(e.message, e.status);
    throw e;
  }
};

const view = (p) => ({ kind: p.kind, label: p.label, kit: p.kit.text, global: p.global ?? null, project: p.project ?? null, effective: p.effective });

// root: the workspace (project overrides), or null for the Global blueprint.
export function reviewPromptsData({ root = null, kitRoot, env }) {
  let enabled = null;
  if (root) {
    const manifest = readManifest(root);
    enabled = Boolean(manifest && enabledModules(manifest).includes('review'));
  }
  return asForm(() => ({ scope: root ? 'project' : 'global', enabled, prompts: allPrompts({ root, env, kitRoot }).map(view) }));
}

function scopeOf(input) {
  if (input.scope !== 'project' && input.scope !== 'global') throw new FormError('Choose project or global');
  return input.scope;
}

export function saveReviewPrompt({ root, kitRoot, env, input }) {
  const scope = scopeOf(input);
  if (typeof input.text !== 'string') throw new FormError('Enter the prompt text');
  if (input.expected !== null && typeof input.expected !== 'string') throw new FormError('Reload the prompt and edit again');
  const saved = asForm(() => savePrompt({ scope, kind: input.kind, text: input.text, expected: input.expected, root: scope === 'project' ? root : null, env, kitRoot }));
  return { ...saved, message: `Saved ${saved.path}.${scope === 'project' ? ' Commit it so the team reviews with the same prompt.' : ' Projects without their own prompt use it now.'}` };
}

export function removeReviewPrompt({ root, env, input }) {
  const scope = scopeOf(input);
  if (input.expected !== null && typeof input.expected !== 'string') throw new FormError('Reload the prompt and edit again');
  const result = asForm(() => removePrompt({ scope, kind: input.kind, expected: input.expected, root: scope === 'project' ? root : null, env }));
  return { ...result, message: scope === 'project' ? 'Project prompt removed; the blueprint or kit default applies again.' : 'Blueprint removed; the kit default applies again.' };
}
