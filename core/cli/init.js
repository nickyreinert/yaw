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
import { deriveFacts } from '../interview/facts.js';
import { runInterview } from '../interview/engine.js';
import { suggestProfiles } from '../interview/suggest.js';
import { collectQuestions, hasModule, listProfiles } from '../render/kit.js';
import { MANIFEST } from '../render/files.js';
import { readManifest } from '../render/manifest.js';
import { ANSWERS, ProjectError, initProject, parseAnswers, renderInit, selectModules } from '../render/project.js';
import { printReport, UsageError } from './commands.js';
import { confirm } from './prompt.js';
import { codexTrustNote } from './doctor.js';
import { CODEX_HOOKS } from '../render/agents.js';

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

// Every question with its answer; one the answers file does not have takes its default and is marked as such.
function summaryAnswers(questions, given, defaulted) {
  const out = {};
  for (const q of questions) {
    if (Object.hasOwn(given, q.id)) out[q.id] = given[q.id];
    else {
      out[q.id] = q.default;
      defaulted.add(q.id);
    }
  }
  for (const [id, value] of Object.entries(given)) if (!Object.hasOwn(out, id)) out[id] = value;
  return out;
}

function describeFacts(facts) {
  const parts = Object.entries(facts).map(([k, v]) => `${k}=${v}`);
  return parts.length > 0 ? parts.join(', ') : 'no facts known';
}

function printSummary(out, { mode, profile, how, modules, skippedModules, answers, defaulted, desired }) {
  out.write(`\nSummary (${mode} setup)\n`);
  out.write(`  profile: ${profile} (${how})\n`);
  out.write(`  modules: ${modules.join(', ')}\n`);
  for (const m of skippedModules) out.write(`  note: module "${m}" is not in this kit yet; skipped\n`);
  out.write('  answers:\n');
  const width = Math.max(...Object.keys(answers).map((k) => k.length));
  for (const [id, value] of Object.entries(answers)) {
    const shown = Array.isArray(value) ? value.join(', ') : String(value);
    out.write(`    ${id.padEnd(width)}  ${shown === '' ? '(empty)' : shown}${defaulted.has(id) ? '  (default)' : ''}\n`);
  }
  const paths = [...desired.keys(), ANSWERS, MANIFEST].sort();
  const bases = [...desired.values()].filter((d) => d.managed !== false).length;
  out.write(`  files (${paths.length}, plus ${bases} base copies in .yaw/base/):\n`);
  for (const p of paths) out.write(`    ${p}${desired.get(p)?.managed === false ? '  (your code from the start)' : ''}\n`);
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

export async function init({ values, positionals, io }) {
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  const root = io.cwd;
  const kitRoot = io.kitRoot;
  const fromFile = Boolean(values.answers);
  if (!fromFile && !io.prompter.interactive) throw new UsageError('no terminal for the interview: run yaw init --answers <file> --yes');
  if (fromFile && !values.yes && !io.prompter.interactive) throw new UsageError('confirmation needed: run again with --yes');
  if (readManifest(root)) throw new ProjectError(`${MANIFEST} already exists; use yaw update`);

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
    const questions = collectQuestions(kitRoot, ['core']);
    const r = await runInterview({ questions, mode: 'quick', prompter: io.prompter, kitRoot });
    defaulted = new Set(r.defaulted);
    answersDoc = { mode: 'quick', answers: r.answers };
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
  printSummary(io.stdout, { mode: answersDoc.mode, profile: chosen.join(', '), how, modules, skippedModules, answers: summaryAnswers(collectQuestions(kitRoot, ['core']), answersDoc.answers, defaulted), defaulted, desired });
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
  io.stdout.write(`  wrote ${ANSWERS} and ${MANIFEST}\n`);
  if (result.manifest.files.some((f) => f.path === CODEX_HOOKS)) io.stdout.write(`  note: ${codexTrustNote()}\n`);

  // verify
  if (values['skip-verify']) {
    io.stdout.write('verification skipped (--skip-verify); run: just setup && just check\n');
    return 0;
  }
  const ok = await verifyProject({ root, io });
  if (ok) io.stdout.write('\nverified: just setup and just check passed\n');
  return ok ? 0 : 1;
}
