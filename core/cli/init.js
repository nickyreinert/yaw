// `yaw init` (Y-3.7, doc 02 §1): collect -> confirm -> apply -> verify.
//
//   collect  interview on the terminal, or --answers <file>; nothing is written
//   confirm  summary of the decisions and the files; --yes confirms, otherwise ask
//   apply    render, write files, bases and the manifest (the only step that writes)
//   verify   `just setup && just check` in the new project
// Without an LLM the profile comes from the answers (suggestWhen); `proposal:` is filled in from that.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stringify } from '../lib/yaml.js';
import { envFileExists, envNames, writeEnvSecrets } from '../lib/env-secrets.js';
import { deriveFacts } from '../interview/facts.js';
import { runInterview, whenMatches } from '../interview/engine.js';
import { suggestProfiles } from '../interview/suggest.js';
import { collectQuestions, hasModule, listProfiles } from '../render/kit.js';
import { MANIFEST, readProjectFile } from '../render/files.js';
import { readManifest } from '../render/manifest.js';
import { ANSWERS, ProjectError, initProject, parseAnswers, checkDependencies, renderInit, selectModules } from '../render/project.js';
import { printReport, UsageError } from './commands.js';
import { printToolHints } from './tool-hints.js';
import { confirm } from './prompt.js';
import { codexTrustNote } from './doctor.js';
import { printNextSteps } from './next-steps.js';
import { guardFolder } from './folder-guard.js';
import { githubStatus, withGitHubHint } from '../lib/github-status.js';
import { CODEX_HOOKS } from '../render/agents.js';
import { saveSetup, secretFindings, userDir } from '../lib/user-store.js';
import { initWeb } from '../web/init.js';

// Ask for the profile; the suggestion is the default. Without one the user must choose.
async function chooseProfile({ prompter, profiles, suggestion }) {
  prompter.show('\nStack profile\n');
  profiles.forEach((p, i) => prompter.show(`  ${i + 1}) ${p.name} - ${p.summary}\n`));
  prompter.show(suggestion ? `  Suggested from your answers: ${suggestion}\n` : '  No single profile matches your answers; choose one.\n');
  for (;;) {
    const reply = (await prompter.ask(`  Profile${suggestion ? ` [${suggestion}]` : ''} > `)).trim();
    if (reply === '' && suggestion) return suggestion;
    const hit = profiles.find((p, i) => p.name === reply || String(i + 1) === reply);
    if (hit) return hit.name;
    prompter.show(`  choose one of: ${profiles.map((p) => p.name).join(', ')}\n`);
  }
}

// Setup depth, the first choice (BUILD.md step 7, ADR-0032; doc 03 question 1.3 maps to it). -> 'quick' | 'full'
async function chooseMode({ prompter }) {
  prompter.show('\nSetup depth\n');
  prompter.show('  1) quick - prototype or MVP: the essential baseline, short interview with defaults\n');
  prompter.show('  2) full  - long-lived product: the tooling that applies to the project, all questions\n');
  for (;;) {
    const reply = (await prompter.ask('  Setup depth [quick] > ')).trim().toLowerCase();
    if (reply === '' || reply === '1' || reply === 'quick') return 'quick';
    if (reply === '2' || reply === 'full') return 'full';
    prompter.show('  choose quick or full\n');
  }
}

// Every question with its answer; one the answers file does not have takes its default and is marked as such.
function summaryAnswers(questions, given, defaulted) {
  const out = {};
  const effective = Object.fromEntries(questions.map((q) => [q.id, q.default]));
  Object.assign(effective, given);
  const hidden = new Set(questions.filter((q) => !whenMatches(q.when, effective)).map((q) => q.id));
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

function describeFacts(facts) {
  const parts = Object.entries(facts).map(([k, v]) => `${k}=${v}`);
  return parts.length > 0 ? parts.join(', ') : 'no facts known';
}

function printSummary(out, { kitRoot, mode, profile, how, modules, skippedModules, answers, defaulted, desired }) {
  out.write(`\nSummary (${mode} setup)\n`);
  out.write(`  profile: ${profile} (${how})\n`);
  out.write(`  modules: ${modules.join(', ')}\n`);
  for (const m of skippedModules) out.write(`  note: module "${m}" is not in this kit yet; skipped\n`);
  out.write('  answers:\n');
  const hidden = new Set(secretFindings({ answers, kitRoot }).map((f) => f.key)); // a secret typed into an answer is not echoed (doc 08)
  const width = Math.max(...Object.keys(answers).map((k) => k.length));
  for (const [id, value] of Object.entries(answers)) {
    const shown = hidden.has(id) ? '(hidden: looks like a secret)' : Array.isArray(value) ? value.join(', ') : String(value);
    out.write(`    ${id.padEnd(width)}  ${shown === '' ? '(empty)' : shown}${defaulted.has(id) ? '  (default)' : ''}\n`);
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

// Opt-in to ~/.yaw/ (doc 02 §5, ADR-0043): every setup is asked, default no; a "no" writes nothing. No standing yes.
async function offerSave({ io, root, answersDoc, kit }) {
  const dir = userDir(io.env);
  io.stdout.write(`\nThe kit can keep a copy of your answers in ${dir}/ (answers only, never secrets). Each question is asked again the next time.\n`);
  const preset = await confirm(io.prompter, `  Save this setup as a preset in ${dir}/presets/ and add a line (project path, date, kit version) to ${dir}/history.jsonl?`);
  const profile = await confirm(io.prompter, `  Save your preferences (agents, expertise, language, autonomy, ...) in ${dir}/user-profile.yaml?`);
  if (!preset && !profile) {
    io.stdout.write('not saved; nothing was written to the user folder\n');
    return;
  }
  try {
    const r = saveSetup({ env: io.env, kitRoot: io.kitRoot, answers: answersDoc.answers, mode: answersDoc.mode, projectRoot: root, kit, preset, profile });
    if (r.saved) io.stdout.write(`saved${r.preset ? ` preset ${r.preset} (yaw presets list)` : ''}${r.preset && r.profile ? ' and' : ''}${r.profile ? ' user-profile.yaml' : ''} in ${r.dir}\n`);
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
  if (values.web) {
    if (values.answers || values.yes) throw new UsageError('--web cannot be combined with --answers or --yes; confirm in the browser');
    if (readManifest(root)) throw new ProjectError(`${MANIFEST} already exists; use yaw update`);
    if (!(await guardFolder({ root, io, force: values.force }))) return cancelled(io);
    return initWeb({ io, skipVerify: values['skip-verify'], verify: verifyProject });
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
  let how;

  // collect
  if (fromFile) {
    try {
      fileText = readFileSync(resolve(values.answers));
    } catch (e) {
      throw new ProjectError(`cannot read ${values.answers}: ${e.code ?? e.message}`);
    }
    answersDoc = parseAnswers(fileText.toString('utf8'), values.answers);
  } else {
    io.stdout.write('yaw init: a few questions (Enter takes the default, ? explains, skip lists it as "default"). Nothing is written until you confirm.\n');
    const mode = await chooseMode({ prompter: io.prompter });
    // Base questions plus the questions of every module the mode can select (ADR-0009, ADR-0032). The final
    // modules depend on the answers (team, GitHub), so the team case is included; a question of a module that is
    // not selected is hidden by its `when` (team.session-context needs idea.team = team).
    const questions = withGitHubHint(collectQuestions(kitRoot, selectModules({ kitRoot, mode, facts: { team: true, usesGitHub: true } })), githubStatus({ root, env: io.env }));
    const r = await runInterview({ questions, mode, prompter: io.prompter, kitRoot });
    if (r.answers['tasks.use-github'] === false && questions.some((q) => q.id === 'tasks.mode')) {
      io.prompter.show('      Task tracking: local (TASKS.md), because GitHub is off for this project.\n');
    }
    defaulted = new Set(r.defaulted);
    answersDoc = { mode, answers: r.answers };
  }

  // profile and modules (rule-based, no LLM)
  const facts = deriveFacts(answersDoc.answers);
  const { suggestion } = suggestProfiles(profiles, facts);
  let chosen = answersDoc.proposal?.profiles;
  if (chosen) {
    for (const p of chosen) {
      if (!profiles.some((x) => x.name === p)) throw new ProjectError(`profile "${p}" does not exist in this kit (available: ${profiles.map((x) => x.name).join(', ')})`);
    }
    how = 'from the answers file';
  } else if (fromFile) {
    if (!suggestion) throw new ProjectError(`${values.answers}: no single profile matches (${describeFacts(facts)}); add proposal.profiles`);
    chosen = [suggestion];
    how = `suggested from ${describeFacts(facts)}`;
  } else {
    const name = await chooseProfile({ prompter: io.prompter, profiles, suggestion });
    chosen = [name];
    how = name === suggestion ? `suggested from ${describeFacts(facts)}` : 'chosen by you';
  }
  const wanted = answersDoc.proposal?.modules ?? selectModules({ kitRoot, mode: answersDoc.mode, facts });
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
  printSummary(io.stdout, { kitRoot, mode: answersDoc.mode, profile: chosen.join(', '), how, modules, skippedModules, answers: summaryAnswers(collectQuestions(kitRoot, modules), answersDoc.answers, defaulted), defaulted, desired });
  if (!values.yes) {
    if (!(await confirm(io.prompter, '\nWrite these files?'))) {
      io.stdout.write('cancelled; nothing was written\n');
      return 1;
    }
  }

  // apply
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
  if (!fromFile && io.prompter.interactive) await offerSave({ io, root, answersDoc, kit: result.manifest.kit });

  const done = (code) => {
    printNextSteps(io.stdout, { root, kitRoot, answers: answersDoc.answers, modules, profiles: chosen, files: result.manifest.files.map((f) => f.path) });
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
