// The team-mode guards (doc 14 §2, ADR-0031): pure decisions from the branch state and the tool input.
//
//   edits    denied on the default branch, on a detached HEAD, on a branch without an issue number, and while the
//            branch has diverged from its upstream (a person rebases or merges first); files outside the project
//            are not affected
//   git      `git commit` on the default branch, `git push` to the default branch, force pushes, --all / --mirror,
//            and --no-verify (it would skip the commit-msg / pre-push hooks) are denied
//
// Not a shell parser: the guard reads plain git calls (quotes, &&, ;, |, env assignments, git -C ...); other ways to
// commit or push (scripts, aliases, `sh -c`) are caught by the git hooks, the pr-policy check and the ruleset.

import { isAbsolute, relative, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { diverged } from './git.js';

const START = 'Ask the user for the issue number if you do not know it, then run `just task start <#>`.';

// -------------------------------------------------------------------------- shell words

// Split a command line into simple commands, each a list of words. Quotes and backslashes are honoured; the
// separators ; & | && || newline ( ) end a command. Substitutions are not expanded.
export function simpleCommands(line) {
  const commands = [];
  let words = [];
  let word = null;
  const end = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const flush = () => {
    end();
    if (words.length > 0) commands.push(words);
    words = [];
  };
  const s = String(line);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      word = (word ?? '') + s[++i];
    } else if (c === "'") {
      const close = s.indexOf("'", i + 1);
      const stop = close === -1 ? s.length : close;
      word = (word ?? '') + s.slice(i + 1, stop);
      i = stop;
    } else if (c === '"') {
      let j = i + 1;
      let buf = '';
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && j + 1 < s.length && '"\\$`'.includes(s[j + 1])) j++;
        buf += s[j++];
      }
      word = (word ?? '') + buf;
      i = j;
    } else if (/[;&|\n()]/.test(c)) {
      flush();
    } else if (/\s/.test(c)) {
      end();
    } else {
      word = (word ?? '') + c;
    }
  }
  flush();
  return commands;
}

// git's options before the subcommand; these take the next word as their value.
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path']);
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nice', 'nohup', 'time']);

// -> [{ sub, args }] for every git call in the command line.
export function gitCalls(line) {
  const out = [];
  for (const words of simpleCommands(line)) {
    let i = 0;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || WRAPPERS.has(words[i]) || (i > 0 && WRAPPERS.has(words[i - 1]) && words[i].startsWith('-')))) i++;
    if (i >= words.length || words[i].split('/').pop() !== 'git') continue;
    i++;
    while (i < words.length && words[i].startsWith('-')) {
      if (GIT_VALUE_OPTIONS.has(words[i])) i++;
      i++;
    }
    if (i < words.length) out.push({ sub: words[i], args: words.slice(i + 1) });
  }
  return out;
}

// git push options that take the next word as their value.
const PUSH_VALUE_OPTIONS = new Set(['--repo', '--receive-pack', '--exec', '-o', '--push-option']);

// -> { force, all, noVerify, remote, refspecs }
export function parsePush(args) {
  const positional = [];
  const flags = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (PUSH_VALUE_OPTIONS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-') && a !== '-') flags.push(a);
    else positional.push(a);
  }
  const short = flags.filter((f) => /^-[A-Za-z]+$/.test(f)).join('');
  return {
    force: flags.some((f) => /^--force(?:$|-with-lease|-if-includes)/.test(f)) || short.includes('f') || positional.slice(1).some((r) => r.startsWith('+')),
    all: flags.some((f) => ['--all', '--mirror', '--branches'].includes(f)),
    noVerify: flags.includes('--no-verify'),
    remote: positional[0] ?? null,
    refspecs: positional.slice(1),
  };
}

// git commit options that take the next word as their value (a message "-n" is not the flag).
const COMMIT_VALUE_OPTIONS = new Set(['-m', '--message', '-F', '--file', '-C', '--reuse-message', '-c', '--reedit-message', '--author', '--date', '-t', '--template', '--fixup', '--squash', '--cleanup', '--trailer', '--pathspec-from-file']);

// --no-verify, or -n alone or in a cluster of short flags before one that takes a value (-nm "x").
export function commitSkipsHooks(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return false;
    if (a === '--no-verify') return true;
    if (COMMIT_VALUE_OPTIONS.has(a)) {
      i++;
      continue;
    }
    const m = /^-([A-Za-z]+)$/.exec(a);
    if (m) {
      const cut = m[1].search(/[mFCct]/);
      if ((cut === -1 ? m[1] : m[1].slice(0, cut)).includes('n')) return true;
      if (cut !== -1 && cut === m[1].length - 1) i++; // the value is the next word
    }
  }
  return false;
}

// The branch a refspec writes to on the remote ("HEAD" means the current branch).
export function pushTarget(refspec, current) {
  const spec = refspec.replace(/^\+/, '');
  const dst = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec;
  const name = dst.replace(/^refs\/heads\//, '');
  return name === 'HEAD' || name === '@' ? current : name;
}

// -------------------------------------------------------------------------- decisions

const reason = (text) => `YAW team mode: ${text}`;

// Paths an edit touches that lie inside the project. Relative paths are inside; links in the project path are
// resolved, so /var and /private/var on macOS compare equal. No path at all counts as inside (fail closed for a
// patch whose files could not be read).
export function touchesProject(root, paths) {
  if (paths.length === 0) return true;
  const roots = new Set([resolve(root)]);
  try {
    roots.add(realpathSync(root));
  } catch { /* the plain path is enough */ }
  return paths.some((p) => {
    if (!isAbsolute(p)) return true;
    for (const r of roots) {
      const rel = relative(r, resolve(p));
      if (rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) return true;
    }
    return false;
  });
}

// state: branchState(..., { local: true }) or null (no git work tree) -> null (allow) or a deny reason.
export function editDecision(state) {
  if (!state) return null;
  if (state.branch === '') return reason(`HEAD is detached; edits need an issue branch. ${START}`);
  if (state.branch === state.defaultBranch) return reason(`edits on the default branch ${state.branch} are blocked; work on an issue branch. ${START}`);
  if (state.issue === null) return reason(`the branch ${state.branch} carries no issue number (<type>/<issue>-<slug>); edits need an issue branch. ${START}`);
  if (diverged(state)) {
    return reason(`${state.branch} has diverged from ${state.upstream} (${state.ahead} ahead, ${state.behind} behind); edits are blocked until the user rebases or merges it.`);
  }
  return null;
}

// command: the shell command line; state as above -> null (allow) or a deny reason.
export function gitDecision(command, state) {
  if (!state) return null;
  for (const call of gitCalls(command)) {
    if (call.sub === 'commit') {
      if (commitSkipsHooks(call.args)) return reason('git commit --no-verify skips the commit-msg check; commit without it.');
      if (state.branch !== '' && state.branch === state.defaultBranch) return reason(`commits on the default branch ${state.branch} are blocked. ${START}`);
    } else if (call.sub === 'push') {
      const p = parsePush(call.args);
      if (p.force) return reason('force pushes are blocked; ask the user to run it themselves if it is intended.');
      if (p.noVerify) return reason('git push --no-verify skips the pre-push check; push without it.');
      if (p.all) return reason(`git push --all / --mirror would push the default branch ${state.defaultBranch}; push the issue branch only.`);
      const targets = p.refspecs.length > 0 ? p.refspecs.map((r) => pushTarget(r, state.branch)) : [state.branch];
      if (targets.includes(state.defaultBranch)) return reason(`pushing to the default branch ${state.defaultBranch} is blocked; push the issue branch and open a pull request (just pr).`);
    }
  }
  return null;
}
