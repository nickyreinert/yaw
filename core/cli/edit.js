import { collectQuestions, listProfiles } from '../render/kit.js';
import { stackProfile } from '../interview/suggest.js';
import { editProject } from '../render/project.js';
import { runInterview } from '../interview/engine.js';
import { githubStatus, withGitHubHint } from '../lib/github-status.js';
import { createFormModel } from '../web/form-model.js';
import { initWeb } from '../web/init.js';
import { confirmStack, verifyProject } from './init.js';
import { printReport, UsageError } from './commands.js';
import { confirm } from './prompt.js';
import { gitInit, isGitRepo, wantsGit } from '../lib/git-init.js';

export async function edit({ values, positionals: sections, io }) {
  const model = createFormModel({ root: io.cwd, kitRoot: io.kitRoot, env: io.env, edit: true, sections });
  if (values.list) {
    if (values.web || sections.length) throw new UsageError('--list cannot be combined with sections or --web');
    io.stdout.write(`Interview sections: ${model.sectionNames.join(', ')}\nUse yaw edit <section> or yaw edit <question.id>; multiple selectors are allowed.\n`);
    return 0;
  }
  const state = { mode: model.initial.mode, modules: model.initial.modules, answers: { ...model.initial.answers } };
  const browser = () => {
    model.assertUnchanged();
    io.prompter.close?.();
    return initWeb({ io, edit: true, sections, handoff: state, skipVerify: values['skip-verify'], verify: verifyProject });
  };
  if (values.web) return browser();
  if (!io.prompter.interactive) throw new UsageError('no terminal for the interview: run yaw edit --web');
  io.stdout.write('yaw edit: saved answers are defaults; Enter keeps them, w continues in the browser. Nothing is written until you confirm. User-edited files are kept.\n');
  for (;;) {
    const choice = (await io.prompter.ask('Review in the [t]erminal or [w]eb browser? [t] ', { choices: ['t', 'w'], start: 0 })).trim().toLowerCase();
    if (['w', 'web'].includes(choice)) return browser();
    if (['', 't', 'terminal'].includes(choice)) break;
    io.prompter.show('choose t or w\n');
  }
  if (!sections.length) {
    for (;;) {
      const mode = (await io.prompter.ask(`Setup depth [${state.mode}] (quick/basic/pro, w for browser) > `)).trim().toLowerCase();
      if (['w', 'web'].includes(mode)) return browser();
      if (mode === '') break;
      if (['quick', 'basic', 'pro', 'all', 'full', 'standard'].includes(mode)) { state.mode = mode; break; }
      io.prompter.show('choose quick, basic, pro/all or w\n');
    }
  }
  const questions = withGitHubHint(collectQuestions(io.kitRoot, [...new Set([...state.modules, 'communication'])]), githubStatus({ root: io.cwd, env: io.env }))
    .filter((q) => !sections.length || sections.some((s) => q.id === s || q.id.startsWith(`${s}.`)))
    .map((q) => sections.length ? { ...q, reviewSelected: true } : q);
  const result = await runInterview({
    questions, mode: state.mode, prompter: io.prompter, kitRoot: io.kitRoot,
    known: state.answers, defaults: state.answers, allowWeb: true,
  });
  state.answers = { ...state.answers, ...result.answers };
  if (result.web) return browser();
  const profiles = listProfiles(io.kitRoot);
  if (!sections.length || !stackProfile(profiles, state.answers).profile) {
    const stack = await confirmStack({ prompter: io.prompter, profiles, questions: collectQuestions(io.kitRoot, []), answers: state.answers });
    if (stack === 'web') return browser();
    state.answers = stack.answers;
  }
  const preview = model.preview(state, true);
  io.stdout.write(`\nSummary (${state.mode} setup)\n  stack: ${preview.profile}\n  modules: ${preview.modules.join(', ')}\n`);
  for (const [id, value] of Object.entries(preview.answers)) {
    io.stdout.write(`  ${id}: ${Array.isArray(value) ? value.join(', ') : String(value)}\n`);
  }
  for (const file of preview.files) io.stdout.write(`  ${file.action}: ${file.path}\n`);
  io.stdout.write(`${preview.diff}\n`);
  if (!(await confirm(io.prompter, 'Apply these setup changes?'))) {
    io.stdout.write('cancelled; nothing was written\n');
    return 1;
  }
  const prepared = model.normalize(state);
  if (!isGitRepo(io.cwd) && wantsGit(prepared.modules, prepared.doc.answers)
    && (await confirm(io.prompter, 'No git repository here yet; create one now (git init)? Commit checks and the push gate need it.'))) {
    const git = gitInit(io.cwd);
    io.stdout.write(git.created ? 'created a git repository (git init)\n' : `git init failed: ${git.error}; run git init yourself\n`);
  }
  const applied = await editProject({ root: io.cwd, kitRoot: io.kitRoot, answers: prepared });
  printReport(io.stdout, applied);
  if (values['skip-verify']) {
    io.stdout.write('verification skipped (--skip-verify); run: just setup && just check\n');
    return 0;
  }
  return await verifyProject({ root: io.cwd, io }) ? 0 : 1;
}
