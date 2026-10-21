// `yaw gh <verb>` (Y-5.5, ADR-0027): the GitHub scripts behind the `just gh-*`, `branch`, `commit`, `pr`, ... recipes.
//
//   not guarded  branch, commit, pr-status, issue; pr (when the branch already has an upstream)
//   guarded      init, labels, protect, project-add, release; pr (first push of a branch)
//
// A guarded action prints what it will do and then needs a person: stdin and stdout must both be a terminal
// and the user types "y". There is no --yes and no environment switch; scripts and agents cannot run these.
// Nothing is guarded by default: no template, hook or other recipe calls these verbs, and there is
// no verb that merges, force-pushes, deletes a branch or changes the visibility of an existing repository.
// Everything goes through argv arrays (no shell), `gh` is injectable, paths are checked before file I/O.

import { lstatSync } from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { GhError, defaultGh } from '../../../core/lib/gh.js';
import { parseDocument } from '../../../core/lib/yaml.js';
import { parseTasks } from '../../../core/lib/tasks.js';
import { formatError } from '../../../core/lib/schema.js';
import { readProjectFile, resolveInside } from '../../../core/render/files.js';
import { schemas } from '../../../core/render/kit.js';
import {
  ISSUE_TYPES, NameError, SLUG, branchName, checkCommitType, checkIdForMode, checkRepoName, checkSemver,
  commitMessage, parseTaskId, prBody, taskFromBranch,
} from './names.js';

export { GhError, NameError };
export class GhUsageError extends Error {
  // showUsage: the arguments were wrong, so the usage text helps; a refusal (not authorised, dirty tree) does not need it.
  constructor(message, { showUsage = false } = {}) {
    super(message);
    this.showUsage = showUsage;
  }
}

export const CONFIG = '.yaw/github.yaml';
export const PR_TEMPLATE = '.github/pull_request_template.md';
export const WORKFLOW = '.github/workflows/quality-gate.yml';
// The team module's workflow (Y-5.9, ADR-0031): it reports the pr-policy check.
export const PR_POLICY_WORKFLOW = '.github/workflows/pr-policy.yml';
export const RULESET = 'yaw-default-branch';
// Verbs that change shared GitHub state (pr only on its first push); the Claude ask rules must cover each one.
export const GUARDED = ['init', 'labels', 'protect', 'project-add', 'release', 'pr'];
export const VERBS = ['init', 'labels', 'protect', 'branch', 'commit', 'pr', 'pr-status', 'release', 'project-add', 'issue'];
export const USAGE = [
  'usage: yaw gh init [name] [--owner o] [--public] create the repository (private by default), push, labels',
  '       yaw gh labels                                                 create or update the labels of .yaw/github.yaml',
  '       yaw gh protect [--approvals n] [--check name]        ruleset for the default branch, verified afterwards',
  '       yaw gh protect --verify [--approvals n] [--check name]  only compare the ruleset on GitHub with the wanted one (changes nothing)',
  '       yaw gh branch <T-012|#34> <slug...> [--type feat]             branch from the fresh default branch',
  '       yaw gh commit <type> "subject" [--scope s] [--task id]       Conventional Commit with the task footer',
  '       yaw gh pr [--title t] [--ready]                       push the branch, open a draft pull request',
  '       yaw gh pr-status                                              checks and review state of this branch',
  '       yaw gh release <version>                              tag and GitHub release',
  '       yaw gh project-add <issue#> [--status "In progress"]  add an issue to the project board',
  '       yaw gh issue <feature|bug|chore|spike|epic> "title" [--body text] [--priority P1] [--estimate S]',
  'Guarded actions (init, labels, protect, release, project-add, the first push of pr) print their plan and run only when a person types y in a terminal; --yes does not exist.',
].join('\n');

// --------------------------------------------------------------------------- plumbing

const firstLine = (text) => String(text).trim().split('\n')[0];

function makeGit(root, env) {
  return (args, { allowFail = false, input } = {}) => {
    const r = spawnSync('git', args, { cwd: root, env, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new GhUsageError(r.error.code === 'ENOENT' ? 'git is not installed' : `git could not run: ${r.error.code}`);
    const out = { status: r.status, stdout: String(r.stdout).trim(), stderr: String(r.stderr).trim(), raw: String(r.stdout) };
    if (r.status !== 0 && !allowFail) throw new GhUsageError(`git ${args[0]} failed: ${firstLine(r.stderr) || `exit ${r.status}`}`);
    return out;
  };
}

function json(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new GhError(`gh returned invalid JSON for ${what}`);
  }
}

// A project file the user can edit: inside the project, a regular file, not a symbolic link (nor a path through one).
function readPlain(root, rel) {
  const p = resolveInside(root, rel);
  let st;
  try {
    st = lstatSync(p);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new GhUsageError(`${rel} must be a regular file, not a symbolic link`);
  return readProjectFile(root, rel).toString('utf8');
}

// -> { value (validated .yaw/github.yaml, or {}), present }
export function loadConfig(root) {
  const text = readPlain(root, CONFIG);
  if (text === null) return { value: {}, present: false };
  const { value, lines } = parseDocument(text, { file: CONFIG });
  const errors = schemas().validate('github.schema.json', value, { lines });
  if (errors.length > 0) throw new GhUsageError(errors.map((e) => formatError(e, CONFIG)).join('\n'));
  return { value, present: true };
}

// Print the plan, then ask. Returns when authorised; throws (nothing changed) otherwise.
async function authorise(io, title, plan) {
  io.stdout.write(`${title}\n${plan.map((l) => `  - ${l}`).join('\n')}\n`);
  // io.confirm exists only when stdin and stdout are a terminal (core/cli/gh.js).
  if (!io.confirm) {
    throw new GhUsageError('not authorised; nothing was changed. This changes shared GitHub state, so a person must run it in a terminal and type y; scripts and agents cannot');
  }
  if (await io.confirm('Go ahead?')) return;
  throw new GhUsageError('not authorised; nothing was changed');
}

export function defaultBranch(git, config) {
  const head = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { allowFail: true });
  if (head.status === 0 && head.stdout.startsWith('origin/')) return head.stdout.slice('origin/'.length);
  if (config.defaultBranch && git(['check-ref-format', '--branch', config.defaultBranch], { allowFail: true }).status === 0) return config.defaultBranch;
  for (const b of ['main', 'master']) {
    if (git(['show-ref', '--verify', '--quiet', `refs/heads/${b}`], { allowFail: true }).status === 0) return b;
    if (git(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${b}`], { allowFail: true }).status === 0) return b;
  }
  return 'main';
}

function repoInfo(gh) {
  const info = json(gh(['repo', 'view', '--json', 'nameWithOwner,visibility']), 'repo view');
  if (!SLUG.test(info.nameWithOwner ?? '')) throw new GhError('gh returned an unexpected repository name');
  return { slug: info.nameWithOwner, owner: info.nameWithOwner.split('/')[0], visibility: info.visibility };
}

// ------------------------------------------------------------- issue types: native with label fallback

const typeName = (t) => t[0].toUpperCase() + t.slice(1);

// Native issue types (organisation repositories) by lowercase name; an empty set on user repositories
// and whenever the query fails, so every caller falls back to the type:* labels.
export function nativeIssueTypes(gh, slug) {
  const [owner, name] = slug.split('/');
  try {
    const query = 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){issueTypes(first:50){nodes{name}}}}';
    const data = json(gh(['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner}`, '-F', `name=${name}`]), 'issue types');
    const nodes = data?.data?.repository?.issueTypes?.nodes ?? [];
    return new Set(nodes.map((n) => String(n.name).toLowerCase()));
  } catch {
    return new Set();
  }
}

// ------------------------------------------------------------------------------------------ verbs

export async function runGh({ verb, args = [], values = {}, mode, sessionTrailer, io }) {
  if (!VERBS.includes(verb)) throw new GhUsageError(verb ? `unknown verb "${verb}"` : 'missing verb', { showUsage: true });
  if (values.yes) throw new GhUsageError('--yes does not exist: guarded actions run only when a person types y in a terminal');
  const { root, stdout, stderr } = io;
  const ctx = {
    io, root, stdout, stderr, values, args, mode, sessionTrailer,
    gh: io.gh ?? ((a, o) => defaultGh(a, { cwd: root, env: io.env, ...o })),
    git: makeGit(root, io.env),
  };
  try {
    switch (verb) {
      case 'init': return await init(ctx);
      case 'labels': return await labels(ctx);
      case 'protect': return await protect(ctx);
      case 'branch': return branch(ctx);
      case 'commit': return commit(ctx);
      case 'pr': return await pr(ctx);
      case 'pr-status': return prStatus(ctx);
      case 'release': return await release(ctx);
      case 'project-add': return await projectAdd(ctx);
      case 'issue': return issue(ctx);
    }
  } catch (e) {
    if (e instanceof NameError) throw new GhUsageError(e.message, { showUsage: true });
    throw e;
  }
  return 0;
}

const need = (args, n, what) => {
  if (args.length < n) throw new GhUsageError(`missing ${what}`, { showUsage: true });
};

// ---- init (guarded): create the repository, push, labels
async function init(c) {
  const { git, gh, values, args, stdout, root } = c;
  const name = checkRepoName(args[0] ?? basename(root));
  const owner = values.owner;
  if (owner !== undefined && !/^[A-Za-z0-9-]{1,39}$/.test(owner)) throw new GhUsageError(`"${owner}" is not a valid owner`);
  if (git(['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true }).status !== 0) {
    throw new GhUsageError('this folder is not a git repository with a commit yet; run git init and make a first commit');
  }
  if (git(['remote', 'get-url', 'origin'], { allowFail: true }).status === 0) throw new GhUsageError('a remote "origin" exists already; nothing to create');
  const config = loadConfig(root);
  const branch = git(['branch', '--show-current']).stdout;
  const visibility = values.public ? 'PUBLIC (anyone on the internet can read it)' : 'private';
  const target = `${owner ? `${owner}/` : ''}${name}`;
  const wanted = (config.value.labels ?? []).length;
  await authorise(c.io, 'gh init is a guarded action:', [
    `create the ${visibility} repository ${target} on GitHub and add it as remote "origin"`,
    `push the current branch (${branch || 'detached HEAD'}) to it`,
    `create ${wanted} label(s) from ${CONFIG}`,
  ]);
  gh(['repo', 'create', target, values.public ? '--public' : '--private', '--source', '.', '--remote', 'origin', '--push']);
  stdout.write(`created ${target} (${values.public ? 'public' : 'private'}) and pushed ${branch}\n`);
  // The creation was authorised above, so the labels of the same plan need no second question.
  await labels({ ...c, quiet: true });
  return 0;
}

// ---- labels (guarded when something changes)
async function labels(c) {
  const { gh, stdout, root } = c;
  const config = loadConfig(root).value;
  const wanted = config.labels ?? [];
  if (wanted.length === 0) {
    stdout.write(`labels: ${CONFIG} lists no labels; nothing to do\n`);
    return 0;
  }
  const { slug } = repoInfo(gh);
  const native = nativeIssueTypes(gh, slug);
  const have = new Map(json(gh(['label', 'list', '--limit', '500', '--json', 'name,color,description']), 'label list').map((l) => [l.name.toLowerCase(), l]));
  const create = [];
  const edit = [];
  const skipped = [];
  for (const l of wanted) {
    const m = /^type:(.+)$/.exec(l.name);
    if (m && native.has(m[1].toLowerCase())) {
      skipped.push(l.name);
      continue;
    }
    const cur = have.get(l.name.toLowerCase());
    if (!cur) create.push(l);
    else if (cur.color.replace(/^#/, '').toLowerCase() !== l.color.toLowerCase() || (cur.description ?? '') !== (l.description ?? '')) edit.push(l);
  }
  if (skipped.length > 0) stdout.write(`labels: native issue types exist for ${skipped.join(', ')}; those labels are not created\n`);
  if (create.length + edit.length === 0) {
    stdout.write('labels: up to date\n');
    return 0;
  }
  if (!c.quiet) {
    await authorise(c.io, `gh labels changes ${slug}:`, [
      ...create.map((l) => `create ${l.name}`),
      ...edit.map((l) => `update ${l.name}`),
      'labels are never deleted',
    ]);
  }
  for (const l of create) gh(['label', 'create', '--color', l.color, '--description', l.description ?? '', '--', l.name]);
  for (const l of edit) gh(['label', 'edit', '--color', l.color, '--description', l.description ?? '', '--', l.name]);
  stdout.write(`labels: ${create.length} created, ${edit.length} updated\n`);
  return 0;
}

// ---- protect (guarded): ruleset for the default branch, verified afterwards
export function rulesetBody({ approvals, checks, linearHistory }) {
  return {
    name: RULESET,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
    bypass_actors: [],
    rules: [
      { type: 'deletion' },
      { type: 'non_fast_forward' },
      ...(linearHistory ? [{ type: 'required_linear_history' }] : []),
      {
        type: 'pull_request',
        parameters: {
          required_approving_review_count: approvals,
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_review_thread_resolution: false,
        },
      },
      {
        type: 'required_status_checks',
        parameters: { strict_required_status_checks_policy: false, required_status_checks: checks.map((context) => ({ context })) },
      },
    ],
  };
}

// What the ruleset must say, as plain data for the verification.
const essentials = (r) => ({
  enforcement: r.enforcement,
  target: r.target,
  include: [...(r.conditions?.ref_name?.include ?? [])].sort(),
  rules: (r.rules ?? []).map((x) => x.type).sort(),
  approvals: (r.rules ?? []).find((x) => x.type === 'pull_request')?.parameters?.required_approving_review_count,
  checks: ((r.rules ?? []).find((x) => x.type === 'required_status_checks')?.parameters?.required_status_checks ?? []).map((x) => x.context).sort(),
});

function compareRuleset(body, back, problem) {
  const want = JSON.stringify(essentials(body));
  const got = JSON.stringify(essentials(back));
  if (want !== got) throw new GhError(`${problem}\n  wanted ${want}\n  found  ${got}`);
}

async function protect(c) {
  const { gh, values, stdout, root } = c;
  const config = loadConfig(root).value;
  const rules = config.rules ?? {};
  let approvals = rules.approvals ?? 0;
  if (values.approvals !== undefined) {
    if (!/^\d{1,2}$/.test(values.approvals)) throw new GhUsageError('--approvals needs a number between 0 and 99');
    approvals = Number(values.approvals);
  }
  const checks = values.check?.length ? values.check : (rules.requiredChecks ?? ['quality-gate']);
  for (const ch of checks) if (!/^[\w .:/-]{1,100}$/.test(ch)) throw new GhUsageError(`"${ch}" is not a valid check name`);
  // A required check that no workflow reports would block every pull request for good (not checked by --verify,
  // which only compares).
  if (!values.verify && checks.some((ch) => ['quality-gate', 'secret-scan'].includes(ch)) && readPlain(root, WORKFLOW) === null) {
    throw new GhUsageError(`${WORKFLOW} is missing, so the required checks ${checks.join(', ')} would never report; add the ci module (yaw add ci) or change rules.requiredChecks in ${CONFIG}`);
  }
  if (!values.verify && checks.includes('pr-policy') && readPlain(root, PR_POLICY_WORKFLOW) === null) {
    throw new GhUsageError(`${PR_POLICY_WORKFLOW} is missing, so the required check pr-policy would never report; add the team module (yaw add team) or change rules.requiredChecks in ${CONFIG}`);
  }
  const body = rulesetBody({ approvals, checks, linearHistory: rules.linearHistory === true });
  const { slug } = repoInfo(gh);
  const existing = json(gh(['api', `repos/${slug}/rulesets`]), 'rulesets').find((r) => r.name === RULESET);
  // --verify reads and compares only; it changes nothing, so it needs no person at a terminal (ADR-0031).
  if (values.verify) {
    if (!existing) throw new GhError(`the ruleset "${RULESET}" does not exist on ${slug}; a person runs: just gh-protect`);
    compareRuleset(body, json(gh(['api', `repos/${slug}/rulesets/${existing.id}`]), 'ruleset'), `the ruleset "${RULESET}" on ${slug} differs from ${CONFIG}; a person runs: just gh-protect`);
    stdout.write(`protect: ruleset "${RULESET}" on ${slug} matches ${CONFIG}\n`);
    return 0;
  }
  await authorise(c.io, `gh protect ${existing ? 'updates' : 'creates'} the ruleset "${RULESET}" on ${slug}:`, [
    'applies to the default branch; nobody bypasses it',
    'pull request required' + (approvals > 0 ? `, ${approvals} approval(s)` : ', no approvals'),
    `required checks: ${checks.join(', ')}`,
    `no force push, no branch deletion${rules.linearHistory ? ', linear history' : ''}`,
  ]);
  const call = existing ? ['--method', 'PUT', `repos/${slug}/rulesets/${existing.id}`] : ['--method', 'POST', `repos/${slug}/rulesets`];
  const saved = json(gh(['api', ...call, '--input', '-'], { input: JSON.stringify(body) }), 'ruleset');
  compareRuleset(body, json(gh(['api', `repos/${slug}/rulesets/${saved.id}`]), 'ruleset'), 'the ruleset was saved but does not read back as requested');
  stdout.write(`protect: ruleset "${RULESET}" is active on ${slug} and verified\n`);
  return 0;
}

// ---- branch
function branch(c) {
  const { git, values, args, stdout, stderr, root, mode } = c;
  need(args, 2, 'task id and slug');
  const task = parseTaskId(args[0]);
  checkIdForMode(task, mode);
  const name = branchName({ type: values.type ?? 'feat', task, slug: args.slice(1).join(' ') });
  if (git(['check-ref-format', '--branch', name], { allowFail: true }).status !== 0) throw new GhUsageError(`"${name}" is not a valid branch name`);
  if (git(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], { allowFail: true }).status === 0) throw new GhUsageError(`branch ${name} exists already`);
  const config = loadConfig(root).value;
  const hasOrigin = git(['remote', 'get-url', 'origin'], { allowFail: true }).status === 0;
  const base = defaultBranch(git, config);
  let start = base;
  if (hasOrigin) {
    const f = git(['fetch', '--quiet', '--prune', 'origin'], { allowFail: true });
    if (f.status !== 0) stderr.write(`branch: could not fetch origin (${firstLine(f.stderr)}); starting from the last known ${base}\n`);
    if (git(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${base}`], { allowFail: true }).status === 0) start = `origin/${base}`;
  } else {
    stderr.write(`branch: no remote "origin"; starting from the local ${base}\n`);
  }
  git(['switch', '--quiet', '--create', name, '--no-track', start]);
  stdout.write(`${name} (from ${start})\n`);
  return 0;
}

// ---- commit: the git hooks run (never --no-verify)
function commit(c) {
  const { git, values, args, stdout, stderr } = c;
  need(args, 2, 'type and subject');
  checkCommitType(args[0]);
  const current = git(['branch', '--show-current']).stdout;
  const task = values.task !== undefined ? parseTaskId(values.task) : taskFromBranch(current);
  if (!task) throw new GhUsageError(`branch "${current}" carries no task id; pass --task T-012 (or #34), or create the branch with: just branch`);
  if (git(['diff', '--cached', '--quiet'], { allowFail: true }).status === 0) throw new GhUsageError('nothing is staged; stage your changes with git add first');
  const trailer = c.sessionTrailer?.() ?? null;
  const message = commitMessage({ type: args[0], scope: values.scope, subject: args.slice(1).join(' '), task, trailers: trailer ? [trailer] : [] });
  const r = git(['commit', '--message', message], { allowFail: true });
  if (r.raw) stdout.write(r.raw);
  if (r.stderr) stderr.write(`${r.stderr}\n`);
  return r.status === 0 ? 0 : 1;
}

// ---- pr: push (first push guarded), draft pull request from the template
async function pr(c) {
  const { git, gh, values, stdout, stderr, root, mode } = c;
  const config = loadConfig(root).value;
  const current = git(['branch', '--show-current']).stdout;
  const base = defaultBranch(git, config);
  if (current === '') throw new GhUsageError('HEAD is detached; switch to a branch first');
  if (current === base) throw new GhUsageError(`you are on ${base}; open pull requests from a task branch (just branch)`);
  if (git(['remote', 'get-url', 'origin'], { allowFail: true }).status !== 0) throw new GhUsageError('there is no remote "origin"; run: just gh-init');
  const task = taskFromBranch(current);
  const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFail: true }).status === 0;
  if (!upstream) {
    await authorise(c.io, 'gh pr pushes a new branch:', [`push ${current} to origin (first push, no force)`, 'open a draft pull request']);
  }
  const push = git(upstream ? ['push', 'origin', `refs/heads/${current}:refs/heads/${current}`] : ['push', '--set-upstream', 'origin', `refs/heads/${current}:refs/heads/${current}`], { allowFail: true });
  if (push.status !== 0) throw new GhUsageError(`git push failed: ${firstLine(push.stderr)}`);
  const open = json(gh(['pr', 'list', '--head', current, '--state', 'open', '--json', 'number,url']), 'pr list');
  if (open.length > 0) {
    stdout.write(`pull request #${open[0].number} is updated by the push: ${open[0].url}\n`);
    return 0;
  }
  const baseRef = git(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${base}`], { allowFail: true }).status === 0 ? `origin/${base}` : base;
  const commits = git(['log', '--reverse', '--format=%s', `${baseRef}..HEAD`], { allowFail: true }).stdout.split('\n').filter(Boolean);
  const title = values.title ?? commits[0];
  if (!title) throw new GhUsageError('the branch has no commits of its own; commit first or pass --title');
  const issueNumber = await linkedIssue(c, task, mode);
  const link = task && task.kind === 'task' && issueNumber ? { kind: 'issue', id: String(issueNumber) } : task;
  if (!task) stderr.write('pr: the branch carries no task id, so the pull request links no issue\n');
  const body = prBody({ template: readPlain(root, PR_TEMPLATE) ?? '', commits, task: link });
  const out = gh(['pr', 'create', ...(values.ready ? [] : ['--draft']), '--title', title, '--body', body, '--base', base, '--head', current]);
  stdout.write(`${firstLine(out.split('\n').filter((l) => l.startsWith('http')).join('\n') || out)}\n`);
  return 0;
}

// Both mode: the issue number linked to T-012 in TASKS.md. Only a positive integer is taken from the file.
async function linkedIssue(c, task, mode) {
  if (!task || task.kind !== 'task' || mode !== 'both') return null;
  try {
    const text = readPlain(c.root, 'TASKS.md');
    if (text === null) return null;
    const ledger = parseTasks(text, { file: 'TASKS.md' });
    const hit = [...ledger.active, ...ledger.backlog].find((t) => t.id === task.id);
    return Number.isSafeInteger(hit?.issue) && hit.issue > 0 ? hit.issue : null;
  } catch {
    return null;
  }
}

// ---- pr-status
function prStatus(c) {
  const { gh, git, stdout } = c;
  const current = git(['branch', '--show-current']).stdout;
  if (current === '') throw new GhUsageError('HEAD is detached; switch to a branch first');
  const found = json(gh(['pr', 'list', '--head', current, '--state', 'all', '--json', 'number,title,state,isDraft,reviewDecision,url,statusCheckRollup', '--limit', '1']), 'pr list');
  if (found.length === 0) {
    stdout.write(`no pull request for ${current}\n`);
    return 0;
  }
  const p = found[0];
  stdout.write(`#${p.number} ${p.title} [${p.state}${p.isDraft ? ', draft' : ''}] review: ${p.reviewDecision || 'none yet'}\n${p.url}\n`);
  const checks = p.statusCheckRollup ?? [];
  if (checks.length === 0) stdout.write('checks: none reported\n');
  for (const k of checks) stdout.write(`  ${k.name ?? k.context}: ${k.conclusion || k.status || k.state || 'pending'}\n`);
  return 0;
}

// ---- release (guarded): annotated tag on the up-to-date default branch, GitHub release with generated notes
async function release(c) {
  const { git, gh, values, args, stdout, root } = c;
  need(args, 1, 'version');
  const version = checkSemver(args[0]);
  const tag = `v${version}`;
  const config = loadConfig(root).value;
  const base = defaultBranch(git, config);
  if (git(['branch', '--show-current']).stdout !== base) throw new GhUsageError(`releases are cut from ${base}; switch to it first`);
  if (git(['status', '--porcelain']).stdout !== '') throw new GhUsageError('the working tree has changes; commit or stash them first');
  if (git(['fetch', '--quiet', '--tags', 'origin'], { allowFail: true }).status !== 0) throw new GhUsageError('could not fetch origin');
  if (git(['rev-parse', 'HEAD']).stdout !== git(['rev-parse', `origin/${base}`], { allowFail: true }).stdout) {
    throw new GhUsageError(`${base} differs from origin/${base}; pull or push first`);
  }
  if (git(['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { allowFail: true }).status === 0) throw new GhUsageError(`tag ${tag} exists already`);
  const pre = version.includes('-');
  await authorise(c.io, `gh release publishes ${tag}:`, [
    `create the annotated tag ${tag} on ${git(['rev-parse', '--short', 'HEAD']).stdout}`,
    `push the tag to origin (no force)`,
    `create the GitHub ${pre ? 'pre-release' : 'release'} ${tag} with generated notes`,
  ]);
  git(['tag', '--annotate', '--message', `Release ${tag}`, tag]);
  git(['push', 'origin', `refs/tags/${tag}`]);
  gh(['release', 'create', tag, '--verify-tag', '--generate-notes', '--title', tag, ...(pre ? ['--prerelease'] : [])]);
  stdout.write(`released ${tag}\n`);
  return 0;
}

// ---- project-add (guarded): issue -> project board, optional Status
async function projectAdd(c) {
  const { gh, values, args, stdout, root } = c;
  need(args, 1, 'issue number');
  const task = parseTaskId(args[0]);
  if (task.kind !== 'issue') throw new GhUsageError('project-add takes an issue number (#34)');
  const number = loadConfig(root).value.project?.number;
  if (!number) throw new GhUsageError(`set project.number in ${CONFIG} first`);
  const status = values.status;
  if (status !== undefined && !/^[\w .-]{1,40}$/.test(status)) throw new GhUsageError(`"${status}" is not a valid status`);
  const { slug, owner } = repoInfo(gh);
  await authorise(c.io, `gh project-add changes project ${number} of ${owner}:`, [
    `add ${slug}#${task.id} to the project`,
    ...(status ? [`set Status to "${status}"`] : []),
  ]);
  const item = json(gh(['project', 'item-add', String(number), '--owner', owner, '--url', `https://github.com/${slug}/issues/${task.id}`, '--format', 'json']), 'item-add');
  if (status !== undefined) {
    const project = json(gh(['project', 'view', String(number), '--owner', owner, '--format', 'json']), 'project view');
    const fields = json(gh(['project', 'field-list', String(number), '--owner', owner, '--format', 'json']), 'field-list').fields ?? [];
    const field = fields.find((f) => f.name === 'Status');
    const option = field?.options?.find((o) => o.name.toLowerCase() === status.toLowerCase());
    if (!field || !option) throw new GhUsageError(`the project has no Status option "${status}" (found: ${(field?.options ?? []).map((o) => o.name).join(', ') || 'no Status field'})`);
    gh(['project', 'item-edit', '--id', item.id, '--project-id', project.id, '--field-id', field.id, '--single-select-option-id', option.id]);
  }
  stdout.write(`#${task.id} is on project ${number}${status ? ` (Status: ${status})` : ''}\n`);
  return 0;
}

// ---- issue: native issue type when the repository has it, the type:* label otherwise
function issue(c) {
  const { gh, values, args, stdout } = c;
  need(args, 2, 'type and title');
  const type = args[0].toLowerCase();
  if (!ISSUE_TYPES.includes(type)) throw new GhUsageError(`unknown issue type "${args[0]}" (${ISSUE_TYPES.join(', ')})`);
  const title = args.slice(1).join(' ').replace(/\s+/g, ' ').trim();
  if (title === '') throw new GhUsageError('an issue needs a title');
  const body = values.body ?? '';
  const extra = [];
  if (values.priority !== undefined) {
    if (!/^P[0-3]$/.test(values.priority)) throw new GhUsageError('--priority is P0, P1, P2 or P3');
    extra.push(`priority:${values.priority}`);
  }
  if (values.estimate !== undefined) {
    if (!/^(XS|S|M|L|XL)$/.test(values.estimate)) throw new GhUsageError('--estimate is XS, S, M, L or XL');
    extra.push(`estimate:${values.estimate}`);
  }
  const { slug } = repoInfo(gh);
  const native = nativeIssueTypes(gh, slug).has(type);
  let out;
  if (native) {
    const flags = ['-f', `title=${title}`, '-f', `body=${body}`, '-f', `type=${typeName(type)}`, ...extra.flatMap((l) => ['-f', `labels[]=${l}`])];
    out = json(gh(['api', '--method', 'POST', `repos/${slug}/issues`, ...flags]), 'issue create').html_url ?? '';
  } else {
    out = gh(['issue', 'create', '--title', title, '--body', body, ...[`type:${type}`, ...extra].flatMap((l) => ['--label', l])]);
  }
  const url = out.split('\n').find((l) => l.startsWith('http')) ?? out.trim();
  stdout.write(`${url} (${native ? `issue type ${typeName(type)}` : `label type:${type}`})\n`);
  return 0;
}

