// `yaw session-start` (`just start`) and the issue branch of `just task start <#>` in team mode (ADR-0031).

import { runGh } from '../../github/lib/cli.js';
import { slugify } from '../../github/lib/names.js';
import { defaultGh } from '../../../core/lib/gh.js';
import { branchState, makeGit } from './git.js';
import { sessionStart } from './sync.js';

// The same as the session-start hook, printed to the terminal; it never fails over git or GitHub.
export async function runSessionStart({ io }) {
  const result = await sessionStart({ root: io.root, env: io.env, now: io.now ?? new Date(), gh: io.gh });
  io.stdout.write(result ? `${result.lines.join('\n')}\n` : 'session-start: not a git repository; nothing to sync\n');
  return 0;
}

// Branch type from the issue's type label: a bug gets fix/, everything else feat/.
const branchType = (labels) => ((labels ?? []).some((l) => (l?.name ?? l) === 'type:bug') ? 'fix' : 'feat');

// After `task start #n` assigned the issue: switch to its branch, or create <type>/<n>-<slug> from the fresh
// default branch (github's `branch`). io: { root, env, stdout, stderr, gh }.
export async function startBranch({ number, io }) {
  const git = makeGit(io.root, io.env);
  const state = branchState(io.root, git, { local: true });
  if (!state) {
    io.stderr.write('task: not a git repository; no issue branch was created\n');
    return;
  }
  if (state.issue === number) {
    io.stdout.write(`already on ${state.branch}\n`);
    return;
  }
  const mine = new RegExp(`^[a-z]+/${number}-`);
  const existing = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).stdout.split('\n').find((b) => mine.test(b));
  if (existing) {
    const r = git(['switch', '--quiet', existing], { timeoutMs: 10000 });
    if (r.status !== 0) throw new Error(`could not switch to ${existing}: ${r.stderr.split('\n')[0]}`);
    io.stdout.write(`switched to ${existing}\n`);
    return;
  }
  const gh = io.gh ?? ((a) => defaultGh(a, { cwd: io.root, env: io.env }));
  const issue = JSON.parse(gh(['issue', 'view', String(number), '--json', 'title,labels']));
  let slug;
  try {
    slug = slugify(issue.title);
  } catch {
    slug = 'issue';
  }
  await runGh({ verb: 'branch', args: [`#${number}`, slug], values: { type: branchType(issue.labels) }, mode: 'github', io });
}
