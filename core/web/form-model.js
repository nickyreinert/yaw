// Read-only collection/preview shared by the HTTP actions. No project writes here.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { asksIn, whenMatches, parseReply, validAnswer } from '../interview/engine.js';
import { githubStatus, withGitHubHint } from '../lib/github-status.js';
import { deriveFacts } from '../interview/facts.js';
import { stackProfile } from '../interview/suggest.js';
import { collectQuestions, listProfiles, loadModule, hasModule, kitVersion, schemas } from '../render/kit.js';
import { checkDependencies, enabledModules, parseAnswers, readAnswers, renderInit, renderProject, requireManifest, selectModules, ANSWERS, ProjectError } from '../render/project.js';
import { MANIFEST, hashContent, readProjectFile, resolveInside } from '../render/files.js';
import { parse, stringify } from '../lib/yaml.js';
import { secretFindings, listPresets, readPreset, readUserProfile, userDir, PRESET_NAME } from '../lib/user-store.js';
import { envFileExists, envNames } from '../lib/env-secrets.js';
import { loadCapabilities } from '../cli/agents.js';

export class FormError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function assertSafe(answers, kitRoot) {
  if (!object(answers)) throw new FormError('answers must be an object');
  const findings = secretFindings({ answers, kitRoot });
  // Never include the value, or an untrusted key, in an HTTP error.
  if (findings.length) throw new FormError('An answer looks like a secret. Remove it; this form does not accept or save secrets.');
}

export function createFormModel({ root, kitRoot, env, edit = false, sections = [] }) {
  const manifest = edit ? requireManifest(root) : null;
  const original = edit ? readAnswers(root) : null;
  const originalText = edit ? readProjectFile(root, ANSWERS).toString('utf8') : null;
  const definitions = readdirSync(join(kitRoot, 'modules')).filter((n) => hasModule(kitRoot, n)).sort()
    .map((n) => loadModule(kitRoot, n));
  definitions.sort((a, b) => a.name === 'core' ? -1 : b.name === 'core' ? 1 : a.name.localeCompare(b.name));
  const names = definitions.map((d) => d.name);
  const questions = collectQuestions(kitRoot, names);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const profiles = listProfiles(kitRoot);
  // A project saved without a stack answer keeps the stack of its current profile.
  if (edit && !stackProfile(profiles, original.answers).profile) {
    const current = profiles.find((p) => p.name === manifest.profiles[0]);
    if (current) original.answers = { ...original.answers, 'arch.language': current.stack.language[0], 'arch.runs-on': current.stack.runsOn[0] };
  }
  const owner = new Map(definitions.flatMap((d) => (d.questions ?? []).map((q) => [q.id, d.name])));
  const editableQuestions = edit ? questions.filter((q) => enabledModules(manifest).includes(owner.get(q.id) ?? 'core')) : questions;
  const sectionNames = [...new Set(editableQuestions.map((q) => q.id.split('.')[0]))];
  for (const section of sections) {
    if (!sectionNames.includes(section) && !editableQuestions.some((q) => q.id === section)) throw new FormError(`Unknown interview section or question "${section}"; choose ${sectionNames.join(', ')}`);
  }
  const editable = (q) => !sections.length || sections.some((s) => q.id === s || q.id.startsWith(`${s}.`));
  const initial = edit ? {
    mode: original.mode, answers: original.answers, modules: enabledModules(manifest),
  } : null;

  function assertUnchanged() {
    if (edit && (readProjectFile(root, ANSWERS)?.toString('utf8') !== originalText ||
      JSON.stringify(requireManifest(root)) !== JSON.stringify(manifest))) {
      throw new FormError('Project setup changed since this editor opened; restart yaw edit before applying', 409);
    }
  }

  function validateGiven(given) {
    assertSafe(given, kitRoot);
    for (const [id, value] of Object.entries(given)) {
      const q = byId.get(id);
      if (!q) throw new FormError('Unknown answer key');
      const valid = validAnswer(q, value) && !(q.type === 'text' && value.length > 8192);
      if (!valid) throw new FormError(`Invalid answer for ${q.id}`);
      // Use the interview parser too, without returning its input-echoing error messages.
      if (q.type !== 'text' && !(q.type === 'multi' && value.length === 0)) {
        const reply = Array.isArray(value) ? value.join(',') : String(value);
        if (parseReply(q, reply).error) throw new FormError(`Invalid answer for ${q.id}`);
      }
    }
  }
  if (edit) validateGiven(original.answers);

  function normalize(input) {
    assertUnchanged();
    if (!object(input) || Object.keys(input).some((k) => !['mode', 'answers', 'modules', 'consent', 'saveProfile', 'gitInit'].includes(k))) {
      throw new FormError('Expected a setup object with mode, answers and optional modules');
    }
    if (input.gitInit !== undefined && typeof input.gitInit !== 'boolean') throw new FormError('gitInit must be true or false');
    if (!['quick', 'full', 'standard'].includes(input.mode)) throw new FormError('Choose Quick or Full');
    let given = input.answers ?? {};
    validateGiven(given);
    if (edit) {
      if (sections.length && Object.entries(given).some(([id, value]) => !editable(byId.get(id)) &&
        JSON.stringify(value) !== JSON.stringify(original.answers[id]))) {
        throw new FormError('An answer is outside the selected interview sections; run yaw edit without sections');
      }
      if (sections.length && (input.mode !== original.mode ||
        (input.modules != null && JSON.stringify(input.modules) !== JSON.stringify(initial.modules)))) {
        throw new FormError('Section editing cannot change setup depth or module selection; run yaw edit without sections');
      }
      given = { ...original.answers, ...Object.fromEntries(Object.entries(given).filter(([id]) => editable(byId.get(id)))) };
    }
    // Same ordering as runInterview: asked questions, then mode-defaulted questions.
    const normalizeFor = (qs) => {
      const answers = edit ? { ...original.answers } : {};
      const defaulted = [];
      for (const asked of [true, false]) for (const q of qs) {
        if (edit && !editable(q)) continue;
        if (asksIn(q.mode, input.mode) !== asked || !whenMatches(q.when, answers)) continue;
        const use = Object.hasOwn(given, q.id) && (edit || (asked && !(answers['user.expertise'] === 'layperson' && q.mode === 'F')));
        answers[q.id] = use ? given[q.id] : q.default;
        if (!use) defaulted.push(q.id);
      }
      return { answers: edit ? answers : Object.fromEntries(qs.filter((q) => Object.hasOwn(answers, q.id)).map((q) => [q.id, answers[q.id]])), defaulted };
    };
    const facts = deriveFacts(normalizeFor(questions).answers);
    let modules = input.modules;
    if (modules === undefined || modules === null) modules = edit ? initial.modules : selectModules({ kitRoot, mode: input.mode, facts });
    if (!Array.isArray(modules) || modules.length > names.length || new Set(modules).size !== modules.length ||
      !modules.includes('core') || modules.some((n) => !names.includes(n))) throw new FormError('Invalid module selection; core is required');
    modules = names.filter((n) => modules.includes(n));
    try { checkDependencies({ kitRoot, modules }); }
    catch (e) { if (e instanceof ProjectError) throw new FormError(e.message); throw e; }
    const selected = collectQuestions(kitRoot, modules);
    const selectedIds = new Set(selected.map((q) => q.id));
    // GitHub owns its own opt-out. Keep that selection-driving answer even when it removes its owner.
    const answerQuestions = questions.filter((q) => selectedIds.has(q.id) ||
      (q.id === 'tasks.use-github' && Object.hasOwn(given, q.id)));
    const { answers, defaulted } = normalizeFor(answerQuestions);
    assertSafe(answers, kitRoot);
    const stack = stackProfile(profiles, answers);
    if (!stack.profile) throw new FormError(`Choose another stack: ${stack.reason}`);
    const profile = stack.profile;
    const p = profiles.find((p) => p.name === profile);
    const chosenProfiles = edit && manifest.profiles.includes(profile) ? manifest.profiles : [profile];
    const doc = { ...(original ?? {}), mode: input.mode, answers, proposal: { ...(original?.proposal ?? {}), status: 'confirmed', summary: `${p.name} - ${p.summary}`, profiles: chosenProfiles, modules } };
    const text = stringify(doc);
    try { parseAnswers(text); }
    catch (e) {
      if (e instanceof ProjectError) throw new FormError('Invalid setup answers; select at least one available agent and valid task settings');
      throw e;
    }
    return { doc, text, defaulted, modules, profile, selected, answerQuestions, gitInit: input.gitInit === true };
  }

  function secretCatalog(result, rendered = null) {
    const { desired } = rendered ?? render(result);
    const example = readProjectFile(root, '.env.example') ?? desired.get('.env.example')?.content;
    return { names: envNames(example?.toString('utf8') ?? ''), existingFile: envFileExists(root) };
  }

  function render(result) {
    return edit
      ? renderProject({ root, kitRoot, manifest: { ...manifest, profiles: result.doc.proposal.profiles }, answersDoc: result.doc, modules: result.modules })
      : renderInit({ root, kitRoot, answersDoc: result.doc, modules: result.modules });
  }

  function preview(input, diff = false) {
    const result = normalize(input);
    const { desired } = render(result);
    // Noninteractive init never overwrites an existing module output, even when its template differs.
    const files = [...desired].map(([path, d]) => {
      const current = readProjectFile(root, path);
      const entry = manifest?.files.find((f) => f.path === path);
      const action = !edit ? (existsSync(resolveInside(root, path)) ? 'kept' : 'create')
        : current === null ? (entry ? 'missing' : 'create')
          : d.managed === false || entry?.managed === false ? 'kept'
            : entry && hashContent(current) === entry.hash ? (hashContent(d.content) === entry.hash ? 'kept' : 'update') : 'kept';
      return { path, module: d.module ?? 'core', bytes: Buffer.byteLength(d.content), managed: d.managed !== false, action, excerpt: excerpt(path, d.content) };
    });
    if (edit) for (const entry of manifest.files) {
      if (entry.path === ANSWERS || desired.has(entry.path)) continue;
      const current = readProjectFile(root, entry.path);
      files.push({ path: entry.path, module: entry.module ?? 'core', bytes: null, managed: entry.managed,
        action: entry.managed && current !== null && hashContent(current) === entry.hash ? 'delete' : 'kept' });
    }
    files.push({ path: ANSWERS, module: 'core', bytes: Buffer.byteLength(result.text), managed: true, action: 'write', excerpt: excerpt(ANSWERS, result.text) });
    files.push({ path: MANIFEST, module: 'core', bytes: null, managed: true, action: 'write' });
    files.sort((a, b) => a.path.localeCompare(b.path));
    const expertise = result.doc.answers['user.expertise'];
    const visible = result.selected.filter((q) => (sections.length || (asksIn(q.mode, result.doc.mode) &&
      !(expertise === 'layperson' && q.mode === 'F'))) && whenMatches(q.when, result.doc.answers) && editable(q)).map((q) => q.id);
    const output = {
      mode: result.doc.mode, profile: result.profile,
      modules: result.modules, answers: result.doc.answers, defaulted: result.defaulted, visible, files,
      secrets: secretCatalog(result, { desired }),
      footprint: {
        bytes: files.reduce((n, f) => n + (f.bytes ?? 0), 0),
        baseCopies: [...desired.values()].filter((d) => d.managed !== false).length,
        note: 'Estimated rendered bytes, excluding base copies and manifest. No AI calls; hooks retain their token-free output policy.',
      },
    };
    if (diff) {
      const changes = [...desired].map(([path, d]) => [path, d.content]);
      changes.push([ANSWERS, result.text]);
      output.diff = changes.map(([path, next]) => {
        if (path !== ANSWERS && ['kept', 'missing'].includes(files.find((f) => f.path === path).action)) {
          return `Kept unchanged: ${path} (${edit ? 'user-owned, edited, unchanged or missing file' : 'existing file; init does not overwrite it'}).\n`;
        }
        // No secret-file reads. .env.example is a generated names-only template.
        if (/(^|\/)\.env/.test(path)) return `--- ${path}\n+++ ${path}\n(template omitted; secret files are never read)\n`;
        const current = readProjectFile(root, path);
        if (secretFindings({ answers: { 'idea.text': current?.toString('utf8') ?? '' }, kitRoot }).length) {
          return `--- ${path}\n+++ ${path}\n(existing content looks like a secret; diff omitted)\n`;
        }
        return fullFileDiff(path, current?.toString('utf8') ?? '', String(next));
      }).filter(Boolean).join('\n') + (edit ? files.filter((f) => f.action === 'delete').map((f) => fullFileDiff(f.path, readProjectFile(root, f.path).toString('utf8'), '')).join('\n') : '') +
        '\nManifest and base copies are generated bookkeeping at apply time.\n';
    }
    return output;
  }

  function prefill(kind, name) {
    let doc;
    if (kind === 'profile') {
      try { doc = readUserProfile(env); }
      catch (e) {
        if (e.code || e.name === 'YamlError' || e.message.startsWith('not saved,')) {
          throw new FormError('Saved user profile is unreadable or invalid; nothing was loaded');
        }
        throw e;
      }
      if (!doc) throw new FormError('No saved user profile');
    } else if (kind === 'draft') {
      const bytes = readProjectFile(root, '.yaw/draft.yaml');
      if (!bytes) throw new FormError('No saved draft');
      doc = parseAnswers(bytes.toString('utf8'));
    } else if (kind === 'preset') {
      if (typeof name !== 'string' || !PRESET_NAME.test(name)) throw new FormError('Invalid preset name');
      if (!listPresets(env).some((p) => p.name === name)) throw new FormError('Preset does not exist');
      try { doc = parse(readPreset(env, name)); }
      catch (e) {
        if (e.code || e.name === 'YamlError') throw new FormError('Saved preset is unreadable or invalid; nothing was loaded');
        throw e;
      }
      if (schemas().validate('preset.schema.json', doc).length) throw new FormError('Saved preset is invalid; it was not loaded');
    } else throw new FormError('Choose a saved profile or preset');
    validateGiven(doc.answers);
    return { mode: doc.mode ?? 'quick', answers: doc.answers, modules: doc.proposal?.modules ?? null };
  }

  function bootstrap() {
    return {
      kit: kitVersion(kitRoot),
      profiles: profiles.map(({ name, title, summary, stack, requires }) => ({ name, title, summary, stack, requires: requires ?? [] })),
      modules: definitions.map(({ name, title, group, short, details, what, adds, agentsMd, description, example, cost, depends, default: defaults, appliesTo }) => ({ name, title: title ?? name, group: group ?? 'basics', short: short ?? null, details: details ?? [], what: what ?? null, adds: adds ?? [], rules: ruleLines(agentsMd), description, example: example ?? null, cost: cost ?? null, depends: depends ?? [], defaults, appliesTo })),
      gitRepo: existsSync(join(root, '.git')),
      questions: withGitHubHint(questions, githubStatus({ root, env })).map((q) => {
        let help = '';
        if (q.help) {
          const file = join(kitRoot, 'interview', 'help', `${q.help}.md`);
          if (existsSync(file)) help = readFileSync(file, 'utf8').trim();
        }
        return { ...q, ...(edit && sections.length && editable(q) ? { mode: 'Q' } : {}), owner: owner.get(q.id) ?? 'core', helpText: help };
      }),
      agents: loadCapabilities(kitRoot).agents,
      presets: listPresets(env).map(({ name }) => ({ name })),
      hasUserProfile: existsSync(join(userDir(env), 'user-profile.yaml')),
      hasDraft: existsSync(join(root, '.yaw/draft.yaml')),
      ...(edit ? { editing: true, sections, initial, sectionNames } : {}),
    };
  }
  return { bootstrap, normalize, preview, prefill, definitions, secretCatalog, initial, sectionNames, assertUnchanged };
}

// First lines of a rendered file for the review step. Secret files and binary content are never shown.
const EXCERPT_LINES = 30, EXCERPT_CHARS = 1800;
export function excerpt(path, content) {
  if (/(^|\/)\.env/.test(path)) return null;
  const text = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  if (text.includes('\0')) return null;
  const lines = text.split('\n');
  const head = lines.slice(0, EXCERPT_LINES).join('\n');
  return head.length > EXCERPT_CHARS || lines.length > EXCERPT_LINES ? `${head.slice(0, EXCERPT_CHARS).trimEnd()}\n…` : head;
}
// The rules a module adds to AGENTS.md (the "pre-prompt notes"), one short line each.
const ruleLines = (text) => String(text ?? '').split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
  .map((l) => l.length > 150 ? `${l.slice(0, 147)}…` : l);

// A valid unified diff with whole-file context, deliberately in memory (no scratch files).
export function fullFileDiff(path, before, after) {
  if (before === after) return '';
  const lines = (text, prefix) => text === '' ? [] : text.replace(/\n$/, '').split('\n').map((l) => prefix + l)
    .concat(text.endsWith('\n') ? [] : ['\\ No newline at end of file']);
  const count = (text) => text === '' ? 0 : text.replace(/\n$/, '').split('\n').length;
  return [`--- ${before ? `a/${path}` : '/dev/null'}`, `+++ b/${path}`,
    `@@ -${before ? 1 : 0},${count(before)} +${after ? 1 : 0},${count(after)} @@`,
    ...lines(before, '-'), ...lines(after, '+'), ''].join('\n');
}
