import { currentValue } from '../interview/legacy.js';
import { mkdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFormApi } from '../web/init.js';
import { createFormModel, FormError } from '../web/form-model.js';
import { verifyProject } from '../cli/init.js';
import { safeDirectory, requireValue } from './store.js';
import { executionEnvironment } from './native-agent.js';

export const projectSlug = (slug) => typeof slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 64;
export class HostedProjects {
  constructor({ root, kitRoot, env, store, agents, verify = verifyProject }) {
    Object.assign(this, { root: safeDirectory(root), kitRoot, env, store, agents }); this.interviews = new Map(); this.applying = false;
    this.verify = (options) => verify({ ...options, io: { ...options.io, env: { ...executionEnvironment(env), YAW_KIT: kitRoot } } });
  }
  create({ slug, command = 'init-local', skipVerify = false, handoff = null }, owner) {
    requireValue(!this.closed, 'Host is stopping', 503);
    requireValue(handoff === null, 'Use the interview handoff action after creating a session');
    requireValue(projectSlug(slug), 'Provide a short slug using lower-case letters, digits and single hyphens');
    requireValue(['init-local', 'init-remote', 'telegram'].includes(command), 'Unknown hosted interview mode');
    requireValue(typeof skipVerify === 'boolean', 'skipVerify must be true or false');
    this.expire(); requireValue(this.interviews.size < 100, 'Interview limit reached', 429);
    const id = randomUUID();
    const scratch = mkdtempSync(join(tmpdir(), 'yaw-host-interview-'));
    let model;
    try { model = createFormModel({ root: scratch, kitRoot: this.kitRoot, env: this.env }); }
    catch (e) { rmSync(scratch, { recursive: true, force: true }); throw e; }
    const interview = { id, slug, command, owner, skipVerify, handoff, scratch, model, expires: Date.now() + 30 * 60000, status: 'editing' };
    this.interviews.set(id, interview); return { id, slug, command };
  }
  expire() { for (const [id, value] of this.interviews) if (value.expires < Date.now() && value.status !== 'applying') { rmSync(value.scratch, { recursive: true, force: true }); this.interviews.delete(id); } }
  get(id, owner) {
    requireValue(!this.closed, 'Host is stopping', 503);
    this.expire(); const interview = this.interviews.get(id);
    requireValue(interview && interview.owner === owner, 'Unknown interview', 404); return interview;
  }
  model(interview, input) {
    const language = currentValue('arch.language', input?.answers?.['arch.language']);
    const base = interview.scratch;
    const model = interview.model;
    const choices = model.bootstrap().questions.find((q) => q.id === 'arch.language').choices.map((c) => c.value ?? c);
    requireValue(language === undefined || language === '' || (choices.includes(language) && /^[a-z0-9-]+$/.test(language)), 'Choose a supported programming language');
    const root = language ? join(this.root, language, interview.slug) : base;
    return { root, model };
  }
  bootstrap(id, owner) {
    const i = this.get(id, owner), { model } = this.model(i);
    const catalog = model.bootstrap();
    catalog.questions = catalog.questions.map((q) => q.id === 'user.agents' ? { ...q, choices: [{ value: 'claude', label: 'Claude Code' }], default: ['claude'], hint: 'One native agent on the host.' } : q);
    return { ...catalog, hasDraft: Boolean(i.draft), handoff: i.draft ?? i.handoff, hosted: { id, slug: i.slug, command: i.command, workspaceRoot: this.root }, skipVerify: i.skipVerify };
  }
  async action(id, owner, name, input) {
    const i = this.get(id, owner);
    requireValue(i.status === 'editing', 'Interview already submitted; inspect its project status', 409);
    requireValue(input && typeof input === 'object' && !Array.isArray(input), 'Expected interview input');
    if (name === 'handoff') { this.model(i).model.normalize(input, { allowIncomplete: true }); i.handoff = structuredClone(input); return { saved: true }; }
    if (name === 'prefill') {
      if (input.kind === 'draft') { requireValue(i.draft, 'No draft in this host session'); return structuredClone(i.draft); }
      const result = this.model(i).model.prefill(input.kind, input.name);
      result.answers['user.agents'] = ['claude']; return result;
    }
    requireValue(!input.secrets || (typeof input.secrets === 'object' && !Array.isArray(input.secrets) && !Object.keys(input.secrets).length), 'Enter project secrets privately on the host; hosted interviews do not transmit them');
    const selected = (name === 'file-preview' ? input.setup?.answers : input.answers)?.['user.agents'];
    requireValue(selected === undefined || (Array.isArray(selected) && selected.length === 1 && selected[0] === 'claude'), 'Select exactly one supported host agent: Claude Code');
    input = { ...input, ...(['preview', 'diff', 'apply', 'draft', 'preset'].includes(name) ? { answers: { ...input.answers, 'user.agents': ['claude'] } } : {}) };
    const { root, model } = this.model(i, input);
    if (name === 'draft') { model.normalize(input, { allowIncomplete: true }); i.draft = structuredClone(input); return { message: 'Draft kept in this host session for 30 minutes.' }; }
    const api = createFormApi({ root: i.scratch, kitRoot: this.kitRoot, env: this.env, verify: this.verify, skipVerify: i.skipVerify, model: i.model });
    try {
      if (name !== 'apply') {
        requireValue(['preview', 'diff', 'preset', 'kickoff-prompt', 'kickoff-reply', 'file-preview'].includes(name), 'Unknown interview action', 404);
        const result = await api.action(name, input);
        if (['preview', 'diff'].includes(name)) { result.destination = input.answers?.['arch.language'] ? root : join(this.root, '<language>', i.slug); result.secrets = { names: [], existingFile: false }; }
        return result;
      }
      requireValue(!this.applying, 'Another project is being initialized; retry after it finishes', 409);
      requireValue(this.agents.available(), 'Install Claude Code and the host PTY tool (Python 3 on macOS, script on Linux) before initializing');
      requireValue(this.agents.workers.size < this.agents.maxWorkers, 'Native worker limit reached; stop an idle process first', 409);
      const prepared = api.prepareApply(input);
      requireValue(!existsSync(root), 'Project folder already exists; choose another slug', 409);
      safeDirectory(this.root);
      safeDirectory(join(this.root, prepared.doc.answers['arch.language']), true);
      // mkdir without recursive is the cross-request collision guard. Never adopt an existing folder.
      try { mkdirSync(root, { mode: 0o700 }); } catch (e) { if (e.code === 'EEXIST') throw new FormError('Project folder already exists; choose another slug', 409); throw e; }
      this.applying = true; i.status = 'applying';
      const project = { id: randomUUID(), path: root, slug: i.slug, language: prepared.doc.answers['arch.language'], state: 'initializing', interview: id, command: i.command };
      let outcome = null;
      let writer;
      try {
        this.store.state.projects.push(project); this.store.save();
        // The target is a new empty folder; retain the interview's original defaults while writing there.
        writer = createFormApi({ root, kitRoot: this.kitRoot, env: this.env, verify: this.verify, skipVerify: i.skipVerify, model: i.model });
        const confirmed = writer.prepareApply(input);
        await writer.apply(confirmed, (event) => { if (event.type === 'done') outcome = event; });
        project.state = outcome?.ok ? 'initialized' : 'verification-failed'; this.store.save();
        if (outcome?.ok) {
          try { project.session = this.agents.start(project).id; project.state = 'launched'; }
          catch { project.state = 'launch-failed'; }
        }
        i.status = 'submitted'; this.store.save();
        return { project: { ...project }, session: this.agents.list().find((s) => s.id === project.session) ?? null,
          ok: Boolean(outcome?.ok) && project.state === 'launched', message: project.state === 'launched' ? 'Project initialized. Claude Remote Control is starting.' : `Project ${project.state}. Inspect it on the host before retrying.` };
      } catch {
        project.state = 'initialization-failed'; i.status = 'failed'; this.store.save();
        throw new FormError('Initialization failed; partial files remain on the host. Inspect the project before retrying.', 500);
      } finally { writer?.close(); this.applying = false; }
    } finally { api.close(); }
  }
  async close() {
    this.closed = true;
    // An accepted init is allowed to settle before releasing the service lock.
    while (this.applying) await new Promise((resolve) => setTimeout(resolve, 50));
    for (const i of this.interviews.values()) rmSync(i.scratch, { recursive: true, force: true });
    this.interviews.clear();
  }
}
