// Read-only collection/preview shared by the HTTP actions. No project writes here.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { asksIn, whenMatches, parseReply, validAnswer } from '../interview/engine.js';
import { githubStatus, withGitHubHint } from '../lib/github-status.js';
import { deriveFacts } from '../interview/facts.js';
import { suggestProfiles } from '../interview/suggest.js';
import { collectQuestions, listProfiles, loadModule, hasModule, kitVersion, schemas } from '../render/kit.js';
import { checkDependencies, parseAnswers, renderInit, selectModules, ANSWERS, ProjectError } from '../render/project.js';
import { MANIFEST, readProjectFile, resolveInside } from '../render/files.js';
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

export function createFormModel({ root, kitRoot, env }) {
  const definitions = readdirSync(join(kitRoot, 'modules')).filter((n) => hasModule(kitRoot, n)).sort()
    .map((n) => loadModule(kitRoot, n));
  definitions.sort((a, b) => a.name === 'core' ? -1 : b.name === 'core' ? 1 : a.name.localeCompare(b.name));
  const names = definitions.map((d) => d.name);
  const questions = collectQuestions(kitRoot, names);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const profiles = listProfiles(kitRoot);
  const owner = new Map(definitions.flatMap((d) => (d.questions ?? []).map((q) => [q.id, d.name])));

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

  function normalize(input) {
    if (!object(input) || Object.keys(input).some((k) => !['mode', 'answers', 'profile', 'modules', 'consent', 'saveProfile'].includes(k))) {
      throw new FormError('Expected a setup object with mode, answers, profile and optional modules');
    }
    if (!['quick', 'full', 'standard'].includes(input.mode)) throw new FormError('Choose Quick or Full');
    const given = input.answers ?? {};
    validateGiven(given);
    // Same ordering as runInterview: asked questions, then mode-defaulted questions.
    const normalizeFor = (qs) => {
      const answers = {};
      const defaulted = [];
      for (const asked of [true, false]) for (const q of qs) {
        if (asksIn(q.mode, input.mode) !== asked || !whenMatches(q.when, answers)) continue;
        const use = asked && !(answers['user.expertise'] === 'layperson' && q.mode === 'F') && Object.hasOwn(given, q.id);
        answers[q.id] = use ? given[q.id] : q.default;
        if (!use) defaulted.push(q.id);
      }
      return { answers: Object.fromEntries(qs.filter((q) => Object.hasOwn(answers, q.id)).map((q) => [q.id, answers[q.id]])), defaulted };
    };
    const facts = deriveFacts(normalizeFor(questions).answers);
    let modules = input.modules;
    if (modules === undefined || modules === null) modules = selectModules({ kitRoot, mode: input.mode, facts });
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
    const { suggestion } = suggestProfiles(profiles, deriveFacts(answers));
    const profile = input.profile || suggestion;
    if (!profiles.some((p) => p.name === profile)) throw new FormError('Choose a stack profile; no single profile matches these answers');
    const p = profiles.find((p) => p.name === profile);
    const doc = { mode: input.mode, answers, proposal: { status: 'confirmed', summary: `${p.name} - ${p.summary}`, profiles: [profile], modules } };
    const text = stringify(doc);
    try { parseAnswers(text); }
    catch (e) {
      if (e instanceof ProjectError) throw new FormError('Invalid setup answers; select at least one available agent and valid task settings');
      throw e;
    }
    return { doc, text, defaulted, modules, profile, suggestion, selected, answerQuestions };
  }

  function secretCatalog(result, rendered = null) {
    const { desired } = rendered ?? renderInit({ root, kitRoot, answersDoc: result.doc, modules: result.modules });
    const example = readProjectFile(root, '.env.example') ?? desired.get('.env.example')?.content;
    return { names: envNames(example?.toString('utf8') ?? ''), existingFile: envFileExists(root) };
  }

  function preview(input, diff = false) {
    const result = normalize(input);
    const { desired } = renderInit({ root, kitRoot, answersDoc: result.doc, modules: result.modules });
    // Noninteractive init never overwrites an existing module output, even when its template differs.
    const files = [...desired].map(([path, d]) => ({
      path, bytes: Buffer.byteLength(d.content), managed: d.managed !== false,
      action: existsSync(resolveInside(root, path)) ? 'kept' : 'create',
    }));
    files.push({ path: ANSWERS, bytes: Buffer.byteLength(result.text), managed: true, action: 'write' });
    files.push({ path: MANIFEST, bytes: null, managed: true, action: 'write' });
    files.sort((a, b) => a.path.localeCompare(b.path));
    const expertise = result.doc.answers['user.expertise'];
    const visible = result.selected.filter((q) => asksIn(q.mode, result.doc.mode) &&
      !(expertise === 'layperson' && q.mode === 'F') && whenMatches(q.when, result.doc.answers)).map((q) => q.id);
    const output = {
      mode: result.doc.mode, profile: result.profile, suggestion: result.suggestion ?? null,
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
        if (path !== ANSWERS && files.find((f) => f.path === path).action === 'kept') {
          return `Kept unchanged: ${path} (existing file; init does not overwrite it).\n`;
        }
        // No secret-file reads. .env.example is a generated names-only template.
        if (/(^|\/)\.env/.test(path)) return `--- ${path}\n+++ ${path}\n(template omitted; secret files are never read)\n`;
        const current = readProjectFile(root, path);
        if (secretFindings({ answers: { 'idea.text': current?.toString('utf8') ?? '' }, kitRoot }).length) {
          return `--- ${path}\n+++ ${path}\n(existing content looks like a secret; diff omitted)\n`;
        }
        return fullFileDiff(path, current?.toString('utf8') ?? '', String(next));
      }).filter(Boolean).join('\n') + '\nManifest and base copies are generated bookkeeping at apply time.\n';
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
    return { mode: doc.mode ?? 'quick', answers: doc.answers, profile: doc.proposal?.profiles?.[0] ?? '', modules: doc.proposal?.modules ?? null };
  }

  function bootstrap() {
    return {
      kit: kitVersion(kitRoot),
      profiles: profiles.map(({ name, summary }) => ({ name, summary })),
      modules: definitions.map(({ name, description, depends, default: defaults, appliesTo }) => ({ name, description, depends: depends ?? [], defaults, appliesTo })),
      questions: withGitHubHint(questions, githubStatus({ root, env })).map((q) => {
        let help = '';
        if (q.help) {
          const file = join(kitRoot, 'interview', 'help', `${q.help}.md`);
          if (existsSync(file)) help = readFileSync(file, 'utf8').trim();
        }
        return { ...q, owner: owner.get(q.id) ?? 'core', helpText: help };
      }),
      agents: loadCapabilities(kitRoot).agents,
      presets: listPresets(env).map(({ name }) => ({ name })),
      hasUserProfile: existsSync(join(userDir(env), 'user-profile.yaml')),
      hasDraft: existsSync(join(root, '.yaw/draft.yaml')),
    };
  }
  return { bootstrap, normalize, preview, prefill, definitions, secretCatalog };
}

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
