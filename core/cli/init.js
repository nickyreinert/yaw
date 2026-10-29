// `yaw init` (Y-3.7, doc 02 §1): collect -> confirm -> apply -> verify.
//
//   collect  interview on the terminal, or --answers <file>; nothing is written
//   confirm  summary of the decisions and the files; --yes confirms, otherwise ask
//   apply    render project files, then seed first personal defaults when applicable
//   verify   `just setup && just check` in the new project
// Without an LLM the profile comes from the stack answers (language x runs-on, ADR-0054); `proposal:` is filled in from that.

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { stringify } from '../lib/yaml.js';
import { envFileExists, envNames, writeEnvSecrets } from '../lib/env-secrets.js';
import { loadSetupDefaults } from '../lib/setup-defaults.js';
import { DEPTHS, depthOf } from '../interview/depth.js';
import { deriveFacts } from '../interview/facts.js';
import { runInterview } from '../interview/engine.js';
import { missingAnswers, isPersonal, isPreference, questionApplies } from '../interview/policy.js';
import { hostsFor, profileForStack, stackProfile } from '../interview/suggest.js';
import { collectQuestions, hasModule, listProfiles, loadModule } from '../render/kit.js';
import { MANIFEST, readProjectFile } from '../render/files.js';
import { readManifest } from '../render/manifest.js';
import { gitInit, isGitRepo, wantsGit } from '../lib/git-init.js';
import { ANSWERS, ProjectError, initProject, parseAnswers, checkDependencies, renderInit, selectModules } from '../render/project.js';
import { printReport, UsageError } from './commands.js';
import { printToolHints } from './tool-hints.js';
import { confirm } from './prompt.js';
import { codexTrustNote } from './doctor.js';
import { printNextSteps } from './next-steps.js';
import { kickoffText } from './kickoff.js';
import { guardFolder } from './folder-guard.js';
import { githubStatus, withGitHubHint } from '../lib/github-status.js';
import { CODEX_HOOKS } from '../render/agents.js';
import { listPresets, loadPreferences, seedPersonalPreferences, saveSetup, secretFindings, userDir } from '../lib/user-store.js';
import { initWeb } from '../web/init.js';
import { syncShortcut } from './sync.js';
import { createFormModel } from '../web/form-model.js';
import { chooseInitModules } from './init-modules.js';
import { PLAIN } from './style.js';

// Reply that hands the interview over to the browser form (#162).
const WEB = 'web';

const choiceLabel = (q, value) => q?.choices?.find((c) => (c.value ?? c) === value)?.label ?? value;

// The stack is language x runs-on (ADR-0054). Show the profile it picks; when the kit has no matching profile, ask
// again where it runs, listing the hosting targets covered by this kit. -> { profile, answers } | WEB
export async function confirmStack({ prompter, profiles, questions, answers }) {
  const s = prompter.style ?? PLAIN;
  const langQ = questions.find((q) => q.id === 'arch.language');
  const hostQ = questions.find((q) => q.id === 'arch.runs-on');
  const next = { ...answers };
  for (;;) {
    const language = next['arch.language'];
    const hit = profileForStack(profiles, language, next['arch.runs-on']);
    if (hit) {
      prompter.show(`\n  ${s.bold('Stack')}: ${s.green(hit.title)} (${hit.name})\n`);
      prompter.show(`      ${hit.summary}\n`);
      if (hit.stack.notes?.[next['arch.runs-on']]) prompter.show(`      ${hit.stack.notes[next['arch.runs-on']]}\n`);
      const tools = (hit.requires ?? []).filter((r) => !r.startsWith('just'));
      if (tools.length) prompter.show(`      Requires: ${tools.join(', ')} · yaw doctor\n`);
      return { profile: hit.name, answers: next };
    }
    const hosts = hostsFor(profiles, language, (hostQ?.choices ?? []).map((c) => c.value ?? c));
    if (hosts.length === 0) throw new ProjectError(`no stack for ${language} in this kit`);
    prompter.show(`\nNo YAW profile for ${choiceLabel(langQ, language)} on ${next['arch.runs-on']}. ${s.bold('Where will it run?')}\n`);
    hosts.forEach((h, i) => prompter.show(`  ${s.cyan(`${i + 1})`)} ${choiceLabel(hostQ, h)} - ${profileForStack(profiles, language, h).title}\n`));
    prompter.show(`  ${s.dim('(w switch to browser)')}\n`);
    const reply = (await prompter.ask('  Runs on > ', { choices: [...hosts, 'w'], start: 0 })).trim();
    if (['w', WEB].includes(reply.toLowerCase())) return WEB;
    const pick = hosts.find((h, i) => h === reply || String(i + 1) === reply);
    if (pick) next['arch.runs-on'] = pick;
    else prompter.show(`  choose one of: ${hosts.join(', ')}\n`);
  }
}

// Setup depth, the first choice (BUILD.md step 7, ADR-0032; doc 03 question 1.3 maps to it). -> 'quick' | 'full' | 'previous' | WEB
export async function chooseMode({ prompter }) {
  const s = prompter.style ?? PLAIN;
  prompter.show(`\n${s.bold('Setup depth')}\n`);
  prompter.show(`  ${s.cyan('1)')} ${s.green(s.bold('quick'))} - agents, purpose, language, runtime and GitHub\n`);
  prompter.show(`  ${s.cyan('2)')} basic - Quick plus personal preferences and review gates\n`);
  prompter.show(`  ${s.cyan('3)')} all - every applicable question and optional tool\n`);
  prompter.show(`  ${s.cyan('p)')} Load a previous setup\n`);
  for (;;) {
    prompter.show(`  ${s.dim('(w switch to browser)')}\n`);
    const reply = (await prompter.ask(`  Setup depth [${s.green('quick')}] > `, { choices: ['quick', 'basic', 'all', 'p', 'w'], start: 0 })).trim().toLowerCase();
    if (reply === '' || reply === '1' || reply === 'quick') return 'quick';
    if (reply === '2' || reply === 'basic') return 'basic';
    if (['3', 'pro', 'all'].includes(reply)) return 'pro';
    if (['full', 'standard'].includes(reply)) return reply;
    if (reply === 'p') return 'previous';
    if (['w', WEB].includes(reply)) return WEB;
    prompter.show('  choose quick, basic, all, p to load a previous setup, or w to continue in the browser\n');
  }
}

async function choosePrevious(io) {
  const presets = listPresets(io.env).reverse();
  if (presets.length === 0) {
    io.prompter.show('\nNo saved setups yet. Save a preset at the end of yaw init to reuse it here.\nYou can also copy another project with: yaw init --answers /path/to/project/.yaw/answers.yaml\n');
    return null;
  }
  const s = io.prompter.style ?? PLAIN;
  io.prompter.show(`\n${s.bold('Previous setups')} (newest names first)\n`);
  presets.forEach((p, i) => io.prompter.show(`  ${s.cyan(`${i + 1})`)} ${i === 0 ? s.green(s.bold(p.name)) : p.name}\n`));
  io.prompter.show(`  ${s.cyan('b)')} Back to setup depth\n`);
  for (;;) {
    io.prompter.show(`  ${s.dim('(w switch to browser)')}\n`);
    const reply = (await io.prompter.ask(`  Previous setup [${s.green(presets[0].name)}] > `, { choices: [...presets.map((p) => p.name), 'b', 'w'], start: 0 })).trim();
    if (['w', WEB].includes(reply.toLowerCase())) return WEB;
    if (['b', 'back'].includes(reply.toLowerCase())) return null;
    const preset = reply === '' ? presets[0] : presets.find((p, i) => p.name === reply || String(i + 1) === reply);
    if (!preset) {
      io.prompter.show('  choose a listed setup, b to go back, or w to continue in the browser\n');
      continue;
    }
    const saved = createFormModel({ root: io.cwd, kitRoot: io.kitRoot, env: io.env }).prefill('preset', preset.name);
    io.prompter.show(`\nLoaded ${preset.name} (${DEPTHS.find((d) => d.value === depthOf(saved.mode))?.label ?? saved.mode}). Saved answers are defaults; Enter keeps them.\nReview the previous project's idea and other answers before confirming. No files or secrets are copied.\n`);
    return saved;
  }
}

// Continue in the browser form with what was answered so far (#162). The folder guard already ran; nothing is written here.
function handOff({ io, values, mode, answers = {}, proposed = [], modules }) {
  io.prompter.close?.();
  io.stdout.write('\nContinuing in the browser with your answers so far; nothing was written.\n');
  return initWeb({ io, skipVerify: values['skip-verify'], verify: verifyProject, handoff: { mode, answers, ...(modules ? { modules } : {}), ...(proposed.length ? { proposed } : {}) } });
}

// Every question with its answer; one the answers file does not have takes its default and is marked as such.
function summaryAnswers(questions, given, defaulted) {
  const out = {};
  const effective = Object.fromEntries(questions.map((q) => [q.id, q.default]));
  Object.assign(effective, given);
  const hidden = new Set(questions.filter((q) => !questionApplies(q, effective)).map((q) => q.id));
  for (const q of questions) {
    if (hidden.has(q.id)) continue;
    if (Object.hasOwn(given, q.id)) out[q.id] = given[q.id];
    else {
      out[q.id] = q.default;
      defaulted.add(q.id);
    }
  }
  for (const [id, value] of Object.entries(given)) if (!Object.hasOwn(out, id) && !hidden.has(id)) out[id] = value;
  return out;
}

function printSummary(out, { kitRoot, mode, profile, how, modules, skippedModules, answers, defaulted, sources = {}, desired }) {
  out.write(`\nSummary (${DEPTHS.find((d) => d.value === depthOf(mode))?.label ?? mode} setup)\n`);
  out.write(`  profile: ${profile} (${how})\n`);
  out.write(`  modules: ${modules.join(', ')}\n`);
  for (const m of skippedModules) out.write(`  note: module "${m}" is not in this kit yet; skipped\n`);
  out.write('  answers:\n');
  const hidden = new Set(secretFindings({ answers, kitRoot }).map((f) => f.key)); // a secret typed into an answer is not echoed (doc 08)
  const width = Math.max(...Object.keys(answers).map((k) => k.length));
  for (const [id, value] of Object.entries(answers)) {
    const shown = hidden.has(id) ? '(hidden: looks like a secret)' : Array.isArray(value) ? value.join(', ') : String(value);
    out.write(`    ${id.padEnd(width)}  ${shown === '' ? '(empty)' : shown}${sources[id] ? `  (${sources[id]})` : defaulted.has(id) ? '  (documented default)' : '  (answered)'}\n`);
  }
  const readme = typeof answers['idea.text'] === 'string' && answers['idea.text'].trim() && !desired.has('README.md');
  const paths = [...desired.keys(), ANSWERS, MANIFEST, ...(readme ? ['README.md'] : [])].sort();
  const bases = [...desired.values()].filter((d) => d.managed !== false).length;
  out.write(`  files (${paths.length}, plus ${bases} base copies in .yaw/base/):\n`);
  for (const p of paths) {
    const note = p === 'README.md' && readme ? '  (your idea; an existing README gets an "Idea" section)' : desired.get(p)?.managed === false ? '  (your code from the start)' : '';
    out.write(`    ${p}${note}\n`);
  }
}

function run(cmd, args, { cwd, env, io }) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => io.stdout.write(d));
    child.stderr.on('data', (d) => io.stderr.write(d));
    child.on('error', (e) => resolveRun({ code: null, error: e }));
    child.on('close', (code) => resolveRun({ code }));
  });
}

// `just setup && just check`; stops at the first failure. -> true when both passed.
export async function verifyProject({ root, io }) {
  for (const recipe of ['setup', 'check']) {
    io.stdout.write(`\n$ just ${recipe}\n`);
    const r = await run('just', [recipe], { cwd: root, env: io.env, io });
    if (r.error) {
      io.stderr.write(r.error.code === 'ENOENT'
        ? 'just is not installed, so the project could not be verified (macOS: brew install just; see https://just.systems). Install it, then run: just setup && just check\n'
        : `could not run just: ${r.error.message}\n`);
      return false;
    }
    if (r.code !== 0) {
      io.stderr.write(`just ${recipe} failed (exit ${r.code}); the files are written, fix the problem and run: just setup && just check\n`);
      return false;
    }
  }
  return true;
}

// Saving a project preset remains optional and independent of personal defaults.
async function offerSave({ io, root, answersDoc, kit }) {
  const dir = userDir(io.env);
  io.stdout.write(`\nThe kit can keep a copy of your answers in ${dir}/ (answers only, never secrets). A preset is a reusable project setup; personal defaults are managed separately with yaw defaults.\n`);
  const preset = await confirm(io.prompter, `  Save this setup as a preset in ${dir}/presets/ and add a line (project path, date, kit version) to ${dir}/history.jsonl?`);
  if (!preset) {
    io.stdout.write('Preset not saved; no preset or history entry was written\n');
    return;
  }
  try {
    const r = saveSetup({ env: io.env, kitRoot: io.kitRoot, answers: answersDoc.answers, mode: answersDoc.mode, projectRoot: root, kit, preset, profile: false });
    if (r.saved) io.stdout.write(`saved preset ${r.preset} (yaw presets list) in ${r.dir}\n`);
    else io.stdout.write(`not saved: ${r.findings.map((f) => `${f.key} (${f.rule})`).join(', ')} looks like a secret; saved setups never hold secrets. The value is already in this project: ${ANSWERS}, AGENTS.md and .yaw/base/AGENTS.md\n`);
  } catch (e) {
    io.stdout.write(`not saved: ${e.message}\n`);
  }
}

function cancelled(io) {
  io.stdout.write('cancelled; nothing was written\n');
  return 1;
}

export async function init({ values, positionals, io }) {
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  const root = io.cwd;
  const kitRoot = io.kitRoot;
  if (values.sync) syncShortcut({ spec: values.sync, io });
  if (values.api && values.web) throw new UsageError('--api cannot be combined with --web');
  if (values.web || values.api) {
    if (values.answers || values.yes) throw new UsageError('--web/--api cannot be combined with --answers or --yes; review and apply through the setup interface');
    if (readManifest(root)) throw new ProjectError(`${MANIFEST} already exists; use yaw update`);
    if (!(await guardFolder({ root, io, force: values.force }))) return cancelled(io);
    return initWeb({ io, skipVerify: values['skip-verify'], verify: verifyProject, headless: values.api === true });
  }
  const fromFile = Boolean(values.answers);
  if (!fromFile && !io.prompter.interactive) throw new UsageError('no terminal for the interview: run yaw init --answers <file> --yes');
  if (fromFile && !values.yes && !io.prompter.interactive) throw new UsageError('confirmation needed: run again with --yes');
  if (readManifest(root)) throw new ProjectError(`${MANIFEST} already exists; use yaw update`);
  if (!(await guardFolder({ root, io, force: values.force, yes: values.yes, ignore: fromFile ? [values.answers] : [] }))) return cancelled(io);

  const profiles = listProfiles(kitRoot);
  let answersDoc;
  let fileText = null;
  let defaulted = new Set();
  let sources = {};
  let how;
  let moduleDefaults = [];

  // collect
  if (fromFile) {
    try {
      fileText = readFileSync(resolve(values.answers));
    } catch (e) {
      throw new ProjectError(`cannot read ${values.answers}: ${e.code ?? e.message}`);
    }
    answersDoc = parseAnswers(fileText.toString('utf8'), values.answers);
  } else {
    io.stdout.write('yaw init: Enter keeps the default. Review files before applying.\n');
    let mode;
    const preferences = loadPreferences({ env: io.env, kitRoot });
    if (!preferences.hasDefaults && !preferences.warning) {
      const notice = 'No personal defaults set. Quick uses factory defaults. Basic/All saves your first confirmed personal preferences after Apply. Project choices stay separate. Edit defaults: yaw defaults.';
      io.stdout.write(`\n${(io.prompter.style ?? PLAIN).yellow(notice)}\n`);
    }
    const setupPolicy = loadSetupDefaults({ env: io.env, kitRoot });
    if (setupPolicy.warning) io.stderr.write(`${setupPolicy.warning}\n`);
    moduleDefaults = setupPolicy.modules;
    preferences.answers = { ...setupPolicy.answers, ...preferences.answers };
    if (preferences.warning) io.stderr.write(`${preferences.warning}\n`);
    let defaults = { ...preferences.answers };
    let defaultSources = Object.fromEntries(Object.keys(defaults).map((id) => [id, 'saved personal setting']));
    for (;;) {
      mode = await chooseMode({ prompter: io.prompter });
      if (mode === WEB) return handOff({ io, values, mode: 'quick' });
      if (mode !== 'previous') break;
      const previous = await choosePrevious(io);
      if (previous === WEB) return handOff({ io, values, mode: 'quick' });
      if (!previous) continue;
      mode = previous.mode;
      defaults = { ...preferences.answers, ...previous.answers };
      defaultSources = Object.fromEntries(Object.keys(defaults).map((id) => [id, isPersonal({ id, scope: 'user' }) ? 'saved personal setting' : 'proposed — needs confirmation']));
      break;
    }
    // Base questions plus the questions of every module the mode can select (ADR-0009, ADR-0032). The final
    // modules depend on the answers (team, GitHub), so the team case is included; a question of a module that is
    // not selected is hidden by its `when` (team.session-context needs idea.team = team).
    const potential = readdirSync(resolve(kitRoot, 'modules')).filter((name) => hasModule(kitRoot, name)).sort();
    const reusedModules = selectModules({ kitRoot, mode, facts: deriveFacts(defaults), answers: defaults, defaults: moduleDefaults });
    const interviewModules = depthOf(mode) === 'pro' ? potential : depthOf(mode) === 'basic' ? [...new Set(['core', 'communication', 'tasks', 'review', ...moduleDefaults])] : [...new Set([...reusedModules, ...(hasModule(kitRoot, 'communication') ? ['communication'] : [])])];
    const questions = withGitHubHint(collectQuestions(kitRoot, interviewModules), githubStatus({ root, env: io.env }));
    // Match the browser: personal choices, project, stack, then workflow/tools.
    const isFoundation = (q) => isPreference(q) || q.id === 'user.agents' || /^(idea|arch)\./.test(q.id);
    const rank = (q) => q.id.startsWith('user.') && isFoundation(q) ? 0 : q.id.startsWith('idea.') ? 1 : q.id.startsWith('arch.') ? 2 : 3;
    const ordered = [...questions].sort((a, b) => rank(a) - rank(b));
    const r = { answers: {}, defaulted: [], sources: {} };
    let selectedModules;
    const interview = async (subset, askQuestion = null) => {
      const result = await runInterview({ questions: subset, mode, prompter: io.prompter, kitRoot,
        known: r.answers, defaults, defaultSources, allowWeb: true, askQuestion });
      Object.assign(r.answers, result.answers); Object.assign(r.sources, result.sources);
      r.defaulted.push(...result.defaulted);
      return result.web;
    };
    const browser = () => handOff({ io, values, mode, answers: { ...defaults, ...r.answers }, modules: selectedModules ? selectModules({ kitRoot, mode, answers: r.answers, defaults: moduleDefaults }) : undefined,
      proposed: questions.filter((q) => q.required && Object.hasOwn(defaults, q.id) && !r.sources[q.id]).map((q) => q.id) });
    if (['pro', 'all'].includes(mode)) {
      if (await interview(ordered.filter(isFoundation))) return browser();
      const stack = await confirmStack({ prompter: io.prompter, profiles, questions, answers: r.answers });
      if (stack === WEB) return browser();
      Object.assign(r.answers, stack.answers);
      if (await interview(ordered.filter((q) => q.id === 'tasks.use-github'))) return browser();
      const selection = await chooseInitModules({ prompter: io.prompter, definitions: potential.map((name) => loadModule(kitRoot, name)), defaults: moduleDefaults, answers: r.answers });
      if (selection.web) return browser();
      moduleDefaults = selection.modules;
      selectedModules = selectModules({ kitRoot, mode, answers: r.answers, defaults: moduleDefaults });
      const owners = new Map(potential.flatMap((name) => (loadModule(kitRoot, name).questions ?? []).map((q) => [q.id, name])));
      if (await interview(ordered.filter((q) => !isFoundation(q) && q.id !== 'tasks.use-github'),
        (q) => selectedModules.includes(owners.get(q.id) ?? 'core'))) return browser();
    } else if (await interview(ordered)) return browser();
    // Keep saved answer order identical to the shared browser catalogue.
    r.answers = Object.fromEntries(questions.filter((q) => Object.hasOwn(r.answers, q.id)).map((q) => [q.id, r.answers[q.id]]));
    if (r.answers['tasks.use-github'] === false && questions.some((q) => q.id === 'tasks.mode')) {
      io.prompter.show('      Task tracking: local (TASKS.md), because GitHub is off for this project.\n');
    }
    defaulted = new Set(r.defaulted);
    sources = r.sources;
    answersDoc = { mode, answers: r.answers };
  }

  // profile and modules (rule-based, no LLM)
  let chosen = answersDoc.proposal?.profiles;
  if (fromFile && answersDoc.proposal && answersDoc.proposal.status !== 'confirmed') throw new ProjectError('The project proposal is still proposed; review and confirm it before applying.');
  if (chosen) {
    for (const p of chosen) {
      if (!profiles.some((x) => x.name === p)) throw new ProjectError(`profile "${p}" does not exist in this kit (available: ${profiles.map((x) => x.name).join(', ')})`);
    }
    how = 'from the answers file';
  } else if (fromFile) {
    const stack = stackProfile(profiles, answersDoc.answers);
    if (!stack.profile) throw new ProjectError(`${values.answers}: ${stack.reason}; fix arch.language / arch.runs-on or add proposal.profiles`);
    chosen = [stack.profile];
    how = stack.reason;
  } else {
    const before = answersDoc.answers['arch.runs-on'];
    const r = ['pro', 'all'].includes(answersDoc.mode)
      ? { answers: answersDoc.answers, profile: stackProfile(profiles, answersDoc.answers).profile }
      : await confirmStack({ prompter: io.prompter, profiles, questions: collectQuestions(kitRoot, []), answers: answersDoc.answers });
    if (r === WEB) return handOff({ io, values, mode: answersDoc.mode, answers: answersDoc.answers });
    if (r.answers['arch.runs-on'] !== before) defaulted.delete('arch.runs-on');
    answersDoc = { ...answersDoc, answers: r.answers };
    chosen = [r.profile];
    how = stackProfile(profiles, r.answers).reason;
  }
  if (fromFile && !answersDoc.proposal) {
    const missing = missingAnswers(collectQuestions(kitRoot, []), answersDoc.answers);
    if (missing.length) throw new ProjectError(`Essential project answers are missing: ${missing.join(', ')}; provide them or a confirmed project proposal. --yes does not choose project facts.`);
  }
  const facts = deriveFacts(answersDoc.answers);
  const wanted = answersDoc.proposal?.modules ?? selectModules({ kitRoot, mode: answersDoc.mode, facts, answers: answersDoc.answers, defaults: fromFile ? [] : moduleDefaults });
  const modules = ['core', ...wanted.filter((m) => m !== 'core' && hasModule(kitRoot, m))];
  checkDependencies({ kitRoot, modules });
  const skippedModules = wanted.filter((m) => m !== 'core' && !hasModule(kitRoot, m));
  const profile = profiles.find((p) => p.name === chosen[0]);
  // A file with a proposal is copied byte for byte (ADR-0019); otherwise the proposal is written into the answers.
  const hadProposal = Boolean(answersDoc.proposal);
  if (!hadProposal) {
    answersDoc = {
      ...answersDoc,
      proposal: { status: 'confirmed', summary: `${profile.name} - ${profile.summary}`, profiles: chosen, modules },
    };
  }
  const text = fileText && hadProposal ? fileText : stringify(answersDoc);

  // confirm
  const { desired } = renderInit({ root, kitRoot, answersDoc, modules });
  printSummary(io.stdout, { kitRoot, mode: answersDoc.mode, profile: chosen.join(', '), how, modules, skippedModules, answers: summaryAnswers(collectQuestions(kitRoot, modules), answersDoc.answers, defaulted), defaulted, sources, desired });
  if (!values.yes) {
    if (!(await confirm(io.prompter, '\nWrite these files?'))) {
      io.stdout.write('cancelled; nothing was written\n');
      return 1;
    }
  }

  // apply
  if (!isGitRepo(root) && wantsGit(modules, answersDoc.answers)) {
    const create = values.yes || !io.prompter.interactive
      || (await confirm(io.prompter, 'No git repository here yet; create one now (git init)? Commit checks and the push gate need it.'));
    if (create) {
      const git = gitInit(root);
      io.stdout.write(git.created ? 'created a git repository (git init)\n' : `git init failed: ${git.error}; run git init yourself\n`);
    } else io.stdout.write('no git repository: run git init (or yaw edit) later for commit checks and the push gate\n');
  }
  const result = await initProject({ root, kitRoot, answers: { text, doc: answersDoc }, modules });
  io.stdout.write(`\nyaw init (kit ${result.manifest.kit}, ${modules.join(' + ')}, profile ${chosen.join(', ')})\n`);
  printReport(io.stdout, result);
  printToolHints(io.stdout, modules);
  io.stdout.write(`  wrote ${ANSWERS} and ${MANIFEST}\n`);
  if (result.manifest.files.some((f) => f.path === CODEX_HOOKS)) io.stdout.write(`  note: ${codexTrustNote()}\n`);

  const secretNames = envNames(readProjectFile(root, '.env.example')?.toString('utf8') ?? '');
  let savedSecrets = false;
  if (io.prompter.interactive && secretNames.length > 0) {
    if (envFileExists(root)) {
      io.stdout.write('Existing .env was preserved; YAW does not read or overwrite secret files.\n');
    } else if (typeof io.prompter.askSecret === 'function') {
      io.stdout.write('\nOptional local secrets. Values are hidden and written only to .env (mode 0600); press Enter to skip a value.\n');
      const secretValues = {};
      for (const name of secretNames) secretValues[name] = await io.prompter.askSecret(`  ${name} > `);
      const saved = writeEnvSecrets(root, secretNames, secretValues);
      savedSecrets = saved.written > 0;
      if (savedSecrets) io.stdout.write(`  saved ${saved.written} secret value(s) to .env\n`);
      else io.stdout.write('  no secret values saved\n');
    } else throw new ProjectError('secret variables are available but this terminal cannot provide hidden input; use an interactive terminal');
  }

  // save (opt-in, interview on a terminal only; never with --answers)
  if (!fromFile && io.prompter.interactive) {
    try {
      const seeded = seedPersonalPreferences({ env: io.env, kitRoot, mode: answersDoc.mode, answers: answersDoc.answers, reviewed: Object.keys(sources).filter((id) => isPreference(id) && ['answered', 'confirmed proposal'].includes(sources[id])) });
      if (seeded.saved) io.stdout.write('Saved your first personal defaults. Future project overrides will not change them; use yaw defaults to edit them.\n');
    } catch { io.stderr.write('Personal defaults could not be saved; existing settings were left untouched. Use yaw defaults to review them.\n'); }
  }
  if (!fromFile && io.prompter.interactive) await offerSave({ io, root, answersDoc, kit: result.manifest.kit });

  const done = async (code) => {
    printNextSteps(io.stdout, { root, kitRoot, answers: answersDoc.answers, modules, profiles: chosen, files: result.manifest.files.map((f) => f.path) });
    // Kickoff guidance (#173): interview on a terminal only, like the save offer.
    if (!fromFile && io.prompter.interactive && (await confirm(io.prompter, '\nDo you want guidance to kick off (a planning prompt for your idea)?'))) {
      io.stdout.write(`\n${kickoffText({ root, manifest: result.manifest })}`);
    }
    return code;
  };
  // verify
  if (values['skip-verify']) {
    io.stdout.write('verification skipped (--skip-verify); run: just setup && just check\n');
    return done(0);
  }
  if (savedSecrets) {
    io.stdout.write('verification skipped because new secrets were saved; review the project recipes before running: just setup && just check\n');
    return done(0);
  }
  const ok = await verifyProject({ root, io });
  if (ok) io.stdout.write('\nverified: just setup and just check passed\n');
  return done(ok ? 0 : 1);
}
