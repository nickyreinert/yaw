// Read-only collection/preview shared by the HTTP actions. No project writes here.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseReply, validAnswer } from '../interview/engine.js';
import { asksIn as asksQuestion, isPersonal, isPreference, migrateAnswers, missingAnswers, sourceOf, switchable, questionApplies, applicableArchitectureAnswers } from '../interview/policy.js';
import { readRegular, MAX_BYTES } from './knowledge.js';
import { loadRules, secretRule } from '../../modules/security/lib/guards.js';
import { githubStatus, withGitHubHint } from '../lib/github-status.js';
import { deriveFacts } from '../interview/facts.js';
import { stackProfile } from '../interview/suggest.js';
import { collectQuestions, listProfiles, loadModule, hasModule, kitVersion, profileTools, schemas } from '../render/kit.js';
import { checkDependencies, enabledModules, parseAnswers, readAnswers, renderInit, renderProject, requireManifest, selectModules, splitAnswers, ANSWERS, ProjectError } from '../render/project.js';
import { MANIFEST, hashContent, readProjectFile, resolveInside } from '../render/files.js';
import { parse, stringify } from '../lib/yaml.js';
import { secretFindings, listPresets, loadPreferences, readPreset, readUserProfile, userDir, PRESET_NAME } from '../lib/user-store.js';
import { envFileExists, envNames } from '../lib/env-secrets.js';
import { loadCapabilities } from '../cli/agents.js';
import { validDepth } from '../interview/depth.js';
import { loadSetupDefaults } from '../lib/setup-defaults.js';

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
  const original = edit ? readAnswers(root, { env, kitRoot }) : null;
  const originalText = edit ? readProjectFile(root, ANSWERS).toString('utf8') : null;
  const definitions = readdirSync(join(kitRoot, 'modules')).filter((n) => hasModule(kitRoot, n)).sort()
    .map((n) => loadModule(kitRoot, n));
  definitions.sort((a, b) => a.name === 'core' ? -1 : b.name === 'core' ? 1 : a.name.localeCompare(b.name));
  const names = definitions.map((d) => d.name);
  const preferences = edit ? { answers: {}, warning: null } : loadPreferences({ env, kitRoot });
  const setupPolicy = edit ? { answers: {}, modules: [] } : loadSetupDefaults({ env, kitRoot });
  preferences.answers = { ...setupPolicy.answers, ...preferences.answers };
  const questions = collectQuestions(kitRoot, names).map((q) => Object.hasOwn(preferences.answers, q.id)
    ? { ...q, default: preferences.answers[q.id], defaultSource: 'saved personal setting' } : q);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const profiles = listProfiles(kitRoot);
  // A project saved without a stack answer keeps the stack of its current profile.
  if (edit && !stackProfile(profiles, original.answers).profile) {
    const current = profiles.find((p) => p.name === manifest.profiles[0]);
    if (current) original.answers = { ...original.answers, 'arch.language': current.stack.language[0], 'arch.runs-on': current.stack.runsOn[0] };
  }
  const owner = new Map(definitions.flatMap((d) => (d.questions ?? []).map((q) => [q.id, d.name])));
  const editableQuestions = edit ? questions.filter((q) => (isPreference(q) || enabledModules(manifest).includes(owner.get(q.id) ?? 'core'))) : questions;
  const sectionNames = [...new Set(editableQuestions.map((q) => q.id.split('.')[0]))];
  for (const section of sections) {
    if (!sectionNames.includes(section) && !editableQuestions.some((q) => q.id === section)) throw new FormError(`Unknown interview section or question "${section}"; choose ${sectionNames.join(', ')}`);
  }
  const editable = (q) => !sections.length || sections.some((s) => q.id === s || q.id.startsWith(`${s}.`));
  const initial = edit ? {
    mode: original.mode, answers: original.answers, modules: enabledModules(manifest), scopes: original.scopes ?? {},
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
      const valid = (validAnswer(q, value) || (q.required && value === '')) && !(q.type === 'text' && value.length > 8192);
      if (!valid) throw new FormError(q.maxWords && typeof value === 'string' ? `Use at most ${q.maxWords} words for ${q.label}.` : `Invalid answer for ${q.id}`);
      // Use the interview parser too, without returning its input-echoing error messages.
      if (q.type !== 'text' && !(q.required && value === '') && !(q.type === 'multi' && value.length === 0)) {
        const reply = Array.isArray(value) ? value.join(',') : String(value);
        if (parseReply(q, reply).error) throw new FormError(`Invalid answer for ${q.id}`);
      }
    }
  }
  if (edit) validateGiven(original.answers);

  function normalize(input, { allowIncomplete = false } = {}) {
    assertUnchanged();
    if (!object(input) || Object.keys(input).some((k) => !['mode', 'answers', 'modules', 'scopes', 'consent', 'saveProfile', 'gitInit', 'proposed'].includes(k))) {
      throw new FormError('Expected a setup object with mode, answers and optional modules');
    }
    if (input.gitInit !== undefined && typeof input.gitInit !== 'boolean') throw new FormError('gitInit must be true or false');
    // The Personal / Team switch of each setting (T-027); hooks and project rules have none.
    const scopes = input.scopes ?? original?.scopes ?? {};
    if (!object(scopes) || Object.entries(scopes).some(([id, scope]) => !byId.has(id) || !switchable(byId.get(id)) || !['personal', 'team'].includes(scope))) {
      throw new FormError('Invalid personal or team setting');
    }
    if (!validDepth(input.mode)) throw new FormError('Choose Quick, Basic or All');
    const proposed = input.proposed ?? [];
    if (!Array.isArray(proposed) || proposed.some((id) => !byId.get(id)?.required)) throw new FormError('Invalid proposed project answers');
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
      const sources = {};
      for (const asked of [true, false]) for (const q of qs) {
        if (edit && !editable(q)) continue;
        if (asksQuestion(q, input.mode) !== asked || !questionApplies(q, { ...given, ...answers })) continue;
        const use = Object.hasOwn(given, q.id);
        answers[q.id] = use ? given[q.id] : q.default;
        if (!use) defaulted.push(q.id);
        sources[q.id] = edit && Object.hasOwn(original.answers, q.id) && JSON.stringify(answers[q.id]) === JSON.stringify(original.answers[q.id])
          ? 'saved project setting' : isPersonal(q) && JSON.stringify(answers[q.id]) === JSON.stringify(q.default)
            ? sourceOf(q, false) : sourceOf(q, use);
      }
      return { answers: edit ? applicableArchitectureAnswers(answers) : Object.fromEntries(qs.filter((q) => Object.hasOwn(answers, q.id)).map((q) => [q.id, answers[q.id]])), defaulted, sources };
    };
    const all = normalizeFor(questions);
    const facts = deriveFacts(all.answers);
    let modules = input.modules;
    if (modules === undefined || modules === null) modules = edit ? initial.modules : selectModules({ kitRoot, mode: input.mode, facts, answers: all.answers, defaults: setupPolicy.modules });
    if (!Array.isArray(modules) || modules.length > names.length || new Set(modules).size !== modules.length ||
      !modules.includes('core') || modules.some((n) => !names.includes(n))) throw new FormError('Invalid module selection; core is required');
    modules = names.filter((n) => modules.includes(n));
    try { checkDependencies({ kitRoot, modules }); }
    catch (e) {
      if (e instanceof ProjectError) {
        const dependent = definitions.find((definition) => modules.includes(definition.name) && definition.depends?.some((name) => !modules.includes(name)));
        if (dependent) {
          const missing = dependent.depends.filter((name) => !modules.includes(name)).map((name) => definitions.find((definition) => definition.name === name)?.title ?? name);
          throw new FormError(`Enable ${missing.join(', ')} to use ${dependent.title ?? dependent.name}. These modules provide its shared rules and checks.`);
        }
        throw new FormError(e.message);
      }
      throw e;
    }
    const selected = questions.filter((q) => isPreference(q) || modules.includes(owner.get(q.id) ?? 'core') || asksQuestion(q, input.mode));
    const selectedIds = new Set(selected.map((q) => q.id));
    // GitHub owns its own opt-out. Keep that selection-driving answer even when it removes its owner.
    const answerQuestions = questions.filter((q) => selectedIds.has(q.id) ||
      (q.id === 'tasks.use-github' && Object.hasOwn(given, q.id)));
    const { answers, defaulted, sources } = normalizeFor(answerQuestions);
    assertSafe(answers, kitRoot);
    const stack = stackProfile(profiles, answers);
    const missing = missingAnswers(selected.filter((q) => questionApplies(q, answers) && (!edit || editable(q))), answers);
    const unresolved = [...new Set([...missing, ...proposed])];
    for (const id of unresolved) sources[id] = missing.includes(id) ? 'unanswered' : 'proposed — needs confirmation';
    if (!stack.profile && !missing.some((id) => id.startsWith('arch.'))) throw new FormError(`Choose another stack: ${stack.reason}`);
    if (unresolved.length && !allowIncomplete) throw new FormError(`Essential project answers are missing or need confirmation: ${unresolved.join(', ')}. Choose them or use project planning guidance before applying.`);
    const profile = stack.profile;
    const p = profiles.find((p) => p.name === profile);
    const chosenProfiles = edit && manifest.profiles.includes(profile) ? manifest.profiles : [profile];
    const doc = { ...(original ?? {}), mode: input.mode, answers };
    if (Object.keys(scopes).length) doc.scopes = scopes; else delete doc.scopes;
    if (p && !unresolved.length) doc.proposal = { ...(original?.proposal ?? {}), status: 'confirmed', summary: `${p.name} - ${p.summary}`, profiles: chosenProfiles, modules };
    else delete doc.proposal;
    const text = stringify(doc);
    try { parseAnswers(text); }
    catch (e) {
      if (e instanceof ProjectError) throw new FormError('Invalid setup answers; select at least one available agent and valid task settings');
      throw e;
    }
    return { reviewedPreferences: Object.keys(given).filter(isPreference), doc, text, defaulted, sources, unresolved, modules, profile, selected, answerQuestions, gitInit: input.gitInit === true };
  }

  function secretCatalog(result, rendered = null) {
    const { desired } = rendered ?? render(result);
    const example = readProjectFile(root, '.env.example') ?? desired.get('.env.example')?.content;
    return { names: envNames(example?.toString('utf8') ?? ''), existingFile: envFileExists(root) };
  }

  // What .yaw/answers.yaml will hold: the team answers only; personal ones go to ~/.yaw/user-profile.yaml (T-027).
  const committedAnswers = (result) => splitAnswers({ text: result.text, doc: result.doc, kitRoot }).text;

  function render(result) {
    return edit
      ? renderProject({ root, kitRoot, manifest: { ...manifest, profiles: result.doc.proposal.profiles, agents: result.doc.answers['user.agents'] ?? manifest.agents }, answersDoc: result.doc, modules: result.modules })
      : renderInit({ root, kitRoot, answersDoc: result.doc, modules: result.modules });
  }

  function preview(input, diff = false) {
    const result = normalize(input, { allowIncomplete: true });
    if (result.unresolved.length) return {
      mode: result.doc.mode, profile: result.profile, modules: result.modules, answers: result.doc.answers,
      defaulted: result.defaulted, sources: result.sources, unresolved: result.unresolved,
      visible: result.selected.filter((q) => asksQuestion(q, result.doc.mode) && questionApplies(q, result.doc.answers) && editable(q)).map((q) => q.id),
      files: [], secrets: { names: [], existingFile: false }, footprint: { bytes: 0, baseCopies: 0, note: 'Complete essential project answers to see the file plan.' },
      ...(diff ? { diff: 'Complete essential project answers before inspecting the file diff.' } : {}),
    };
    const { desired } = render(result);
    // Noninteractive init never overwrites an existing module output, even when its template differs.
    const files = [...desired].map(([path, d]) => {
      const current = readProjectFile(root, path);
      const entry = manifest?.files.find((f) => f.path === path);
      const action = !edit ? (existsSync(resolveInside(root, path)) ? 'kept' : 'create')
        : current === null ? (entry ? 'missing' : 'create')
          : d.managed === false || entry?.managed === false ? 'kept'
            : entry && hashContent(current) === entry.hash ? (hashContent(d.content) === entry.hash ? 'kept' : 'update') : 'kept';
      return { path, module: d.module ?? 'core', bytes: Buffer.byteLength(d.content), managed: d.managed !== false, action, contributors: (d.fragments ?? []).map((fragment) => fragment.module), excerpt: excerpt(path, d.content) };
    });
    if (edit) for (const entry of manifest.files) {
      if (entry.path === ANSWERS || desired.has(entry.path)) continue;
      const current = readProjectFile(root, entry.path);
      files.push({ path: entry.path, module: entry.module ?? 'core', bytes: null, managed: entry.managed,
        action: entry.managed && current !== null && hashContent(current) === entry.hash ? 'delete' : 'kept' });
    }
    const committed = committedAnswers(result);
    files.push({ path: ANSWERS, module: 'core', bytes: Buffer.byteLength(committed), managed: true, action: 'write', excerpt: excerpt(ANSWERS, committed) });
    files.push({ path: MANIFEST, module: 'core', bytes: null, managed: true, action: 'write' });
    files.sort((a, b) => a.path.localeCompare(b.path));
    const expertise = result.doc.answers['user.expertise'];
    const visible = result.selected.filter((q) => (sections.length || asksQuestion(q, result.doc.mode)) && questionApplies(q, result.doc.answers) && editable(q)).map((q) => q.id);
    const output = {
      mode: result.doc.mode, profile: result.profile,
      modules: result.modules, answers: result.doc.answers, defaulted: result.defaulted, sources: result.sources, unresolved: [], visible, files,
      instructions: [...desired]
        .filter(([path]) => path === 'AGENTS.md' || path === 'docs/engineering.md' || /^\.(claude|github)\/agents\/review-/.test(path))
        .map(([path, d]) => ({ path, action: files.find((file) => file.path === path).action,
          content: secretFindings({ answers: { 'idea.text': String(d.content) }, kitRoot }).length
            ? '(Content omitted: possible secret.)' : String(d.content) })),
      secrets: secretCatalog(result, { desired }),
      footprint: {
        bytes: files.reduce((n, f) => n + (f.bytes ?? 0), 0),
        baseCopies: [...desired.values()].filter((d) => d.managed !== false).length,
        note: 'Estimated rendered bytes, excluding base copies and manifest. No AI calls; hooks retain their token-free output policy.',
      },
    };
    if (diff) {
      const changes = [...desired].map(([path, d]) => [path, d.content]);
      changes.push([ANSWERS, committed]);
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

  // Resolve only files in the current plan. Return full text on demand, never a truncated excerpt.
  function filePreview(input, path) {
    const result = normalize(input, { allowIncomplete: true });
    const rules = loadRules({ kitRoot, profiles: result.doc.proposal?.profiles ?? [] });
    if (typeof path !== 'string' || /(^|\/)\.env/.test(path) || secretRule(rules, path)) throw new FormError('File content is protected.', 403);
    const provisional = result.unresolved.length > 0;
    const rendered = provisional ? renderInit({ root, kitRoot, modules: result.modules, answersDoc: { ...result.doc,
      answers: Object.fromEntries(Object.entries(result.doc.answers).filter(([id, value]) => !byId.get(id)?.required || value !== '')),
      proposal: { profiles: result.profile ? [result.profile] : [] } } }) : render(result);
    const { desired } = rendered;
    const entry = manifest?.files.find((file) => file.path === path);
    const generated = desired.get(path);
    if (!generated && !entry && ![ANSWERS, MANIFEST].includes(path)) throw new FormError('File is not in the project plan.', 404);
    let current = null;
    try { if (existsSync(resolveInside(root, path))) current = readRegular(root, path); }
    catch { throw new FormError('File is unavailable, too large or not a regular file.', 403); }
    const kept = current !== null && (path === MANIFEST || !edit || generated?.managed === false || entry?.managed === false || !entry || hashContent(current) !== entry.hash);
    const content = path === ANSWERS ? committedAnswers(result) : kept || !generated ? current : String(generated.content);
    if (content === null) return { path, content: null, message: 'Generated when Apply writes the project.' };
    if (Buffer.byteLength(content) > MAX_BYTES) return { path, content: null, message: 'File exceeds the 128 KiB preview limit.' };
    if (content.includes('\0')) return { path, content: null, message: 'Binary file; no text preview.' };
    if (secretFindings({ answers: { 'idea.text': content }, kitRoot }).length) throw new FormError('File content is protected.', 403);
    return { path, content, source: path === ANSWERS || !kept && generated ? (provisional ? 'Provisional content' : 'Planned content') : 'Existing content' };
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
    doc = { ...doc, answers: migrateAnswers(doc.answers) };
    validateGiven(doc.answers);
    return { mode: doc.mode ?? 'quick', answers: doc.answers, modules: doc.proposal?.modules ?? null,
      ...(kind !== 'profile' ? { proposed: questions.filter((q) => q.required && Object.hasOwn(doc.answers, q.id)).map((q) => q.id) } : {}) };
  }

  function bootstrap() {
    return {
      kit: kitVersion(kitRoot),
      profiles: profiles.map((p) => ({ name: p.name, title: p.title, summary: p.summary, stack: p.stack, requires: p.requires ?? [], tools: profileTools(p, null).map(({ name, install, when }) => ({ name, install, ...(when ? { when } : {}) })) })),
      modules: definitions.map(({ name, title, group, short, details, what, adds, agentsMd, description, example, cost, depends, default: defaults, appliesTo, outputs }) => ({ name, savedDefault: setupPolicy.modules.includes(name), title: title ?? name, group: group ?? 'basics', short: short ?? null, details: details ?? [], what: what ?? null, adds: adds ?? [], rules: ruleLines(agentsMd), description, example: example ?? null, cost: cost ?? null, depends: depends ?? [], defaults, appliesTo, plannedFiles: outputs?.templates ?? [] })),
      gitRepo: existsSync(join(root, '.git')),
      questions: withGitHubHint(questions, githubStatus({ root, env, verifyAuth: false })).map((q) => {
        let help = '';
        if (q.help) {
          const file = join(kitRoot, 'interview', 'help', `${q.help}.md`);
          if (existsSync(file)) help = readFileSync(file, 'utf8').trim();
        }
        return { ...q, ...(edit && sections.length && editable(q) ? { reviewSelected: true } : {}), owner: owner.get(q.id) ?? 'core', helpText: help };
      }),
      agents: loadCapabilities(kitRoot).agents,
      presets: listPresets(env).map((preset) => {
        try {
          const saved = parse(readPreset(env, preset.name));
          const safe = secretFindings({ answers: saved?.answers ?? {}, kitRoot }).length === 0;
          const answers = safe ? saved?.answers ?? {} : {};
          return { ...preset, architecture: answers['arch.runs-on'] ?? '', language: answers['arch.language'] ?? '', framework: answers['arch.framework'] ?? '', purpose: String(answers['idea.text'] ?? '').slice(0, 160) };
        } catch { return { name: preset.name }; }
      }),
      hasUserProfile: preferences.hasDefaults === true,
      personalDefaultsNotice: !edit && !preferences.hasDefaults && !preferences.warning ? 'No personal defaults set. Quick uses factory defaults. In Basic or All, the personal answers you confirm will become your defaults after Apply. Project and tool choices stay project-specific.' : null,
      personalWarning: [preferences.warning, setupPolicy.warning].filter(Boolean).join(' ') || null,
      hasDraft: existsSync(join(root, '.yaw/draft.yaml')),
      ...(edit ? { editing: true, sections, initial, sectionNames } : {}),
    };
  }
  return { bootstrap, normalize, preview, filePreview, prefill, definitions, secretCatalog, initial, sectionNames, assertUnchanged };
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
const ruleLines = (text) => String(text ?? '').split('\n').map((l) => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);

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
