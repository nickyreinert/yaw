// The team-mode guards (doc 14 §2, ADR-0031): pure decisions from the branch state and the tool input.
//
//   edits    denied on the default branch, on a detached HEAD, on a branch without an issue number, and while the
//            branch has diverged from its upstream (a person rebases or merges first); files outside the project
//            are not affected
//   git      `git commit` on the default branch, `git push` to the default branch, force pushes, --all / --mirror,
//            --no-verify and core.hooksPath overrides (they would skip the commit-msg / pre-push hooks) are denied;
//            while the branch has diverged, rebase / pull / merge / reset / changing its upstream are denied too
//
// Not a shell parser: the guard reads git calls in simple commands (quotes, &&, ;, |, shell keywords, env assignments,
// wrappers such as env / sudo / nice / timeout, `sh -c "..."`, git's own options and long-option prefixes); other
// ways to commit or push (scripts, aliases, eval) are caught by the git hooks, the pr-policy check and the ruleset.

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

// git accepts any unambiguous prefix of a long option (--no-verif = --no-verify). A word matches an option when it
// is "--" plus at least one letter and a prefix of the option (before any "="). An ambiguous prefix is refused by git
// itself, so treating it as the option only denies a command git would not run.
export function longOption(word, option) {
  const name = String(word).split('=')[0];
  return name.length > 2 && name.startsWith('--') && option.startsWith(name);
}
const anyLong = (word, options) => options.some((o) => longOption(word, o));

// git's options before the subcommand; these take the next word as their value (unless written --opt=value).
const GIT_VALUE_OPTIONS = ['--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path', '--attr-source', '--list-cmds'];
const takesValue = (word, short, long) => short.includes(word) || (!word.includes('=') && anyLong(word, long));

// Words that start a command but are not the command: shell keywords, and wrappers with the options that take a
// value and the number of positional words they take before the command (timeout DURATION).
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', 'time']);
const WRAPPERS = {
  env: { short: ['-u', '-C', '-S'], long: ['--unset', '--chdir', '--split-string'] },
  sudo: { short: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T'], long: ['--user', '--group', '--close-from', '--chdir', '--host', '--prompt', '--role', '--type', '--other-user', '--command-timeout'] },
  nice: { short: ['-n'], long: ['--adjustment'] },
  timeout: { short: ['-s', '-k'], long: ['--signal', '--kill-after'], positional: 1 },
  nohup: {},
  command: {},
  exec: { short: ['-a'] },
  stdbuf: { short: ['-i', '-o', '-e'], long: ['--input', '--output', '--error'] },
  ionice: { short: ['-c', '-n', '-p', '-P', '-u'], long: ['--class', '--classdata', '--pid', '--pgid', '--uid'] },
  xargs: { short: ['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a'], long: ['--replace', '--max-lines', '--max-args', '--max-procs', '--max-chars', '--delimiter', '--eof', '--arg-file'] },
};
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const base = (word) => String(word).split('/').pop();

// -> [{ sub, args, config }] for every git call in the command line; config: the -c / --config-env settings and
// GIT_CONFIG_* assignments in front of it. `sh -c "..."` and `env -S "..."` are read as command lines too.
export function gitCalls(line, depth = 0) {
  const out = [];
  if (depth > 3) return out;
  for (const words of simpleCommands(line)) {
    const config = [];
    let i = 0;
    for (;;) {
      const w = words[i];
      if (w === undefined) break;
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
        if (/^GIT_CONFIG/.test(w)) config.push(w);
        i++;
      } else if (KEYWORDS.has(w)) {
        i++;
      } else if (Object.hasOwn(WRAPPERS, base(w))) {
        const spec = WRAPPERS[base(w)];
        i++;
        while (i < words.length && words[i].startsWith('-') && words[i] !== '-' && words[i] !== '--') {
          const opt = words[i];
          if (base(w) === 'env' && (opt === '-S' || longOption(opt, '--split-string'))) {
            const text = opt.includes('=') ? opt.slice(opt.indexOf('=') + 1) : words[i + 1];
            out.push(...gitCalls(text ?? '', depth + 1));
          }
          i += takesValue(opt, spec.short ?? [], spec.long ?? []) ? 2 : 1;
        }
        if (words[i] === '--') i++;
        i += spec.positional ?? 0;
      } else {
        break;
      }
    }
    if (i >= words.length) continue;
    if (SHELLS.has(base(words[i]))) {
      const c = words.indexOf('-c', i + 1);
      if (c !== -1 && words[c + 1] !== undefined) out.push(...gitCalls(words[c + 1], depth + 1));
      continue;
    }
    if (base(words[i]) !== 'git') continue;
    i++;
    while (i < words.length && words[i].startsWith('-') && words[i] !== '--') {
      const opt = words[i];
      if (opt === '-c' || longOption(opt, '--config-env')) {
        const value = opt === '-c' || !opt.includes('=') ? words[i + 1] : opt.slice(opt.indexOf('=') + 1);
        if (value !== undefined) config.push(value);
        i += opt === '-c' || !opt.includes('=') ? 2 : 1;
      } else if (/^-c./.test(opt)) {
        config.push(opt.slice(2));
        i++;
      } else {
        i += takesValue(opt, ['-C'], GIT_VALUE_OPTIONS) ? 2 : 1;
      }
    }
    if (words[i] === '--') i++;
    if (i < words.length) out.push({ sub: words[i], args: words.slice(i + 1), config });
  }
  return out;
}

// Does a call switch off the git hooks (core.hooksPath through -c, --config-env, GIT_CONFIG_*, or `git config`)?
export function overridesHooks(call) {
  if (call.config.some((c) => /core\.hookspath/i.test(c))) return true;
  return call.sub === 'config' && call.args.some((a) => /core\.hookspath/i.test(a));
}

// git push options that take the next word as their value.
const PUSH_VALUE_SHORT = ['-o'];
const PUSH_VALUE_LONG = ['--repo', '--receive-pack', '--exec', '--push-option'];

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
    if (takesValue(a, PUSH_VALUE_SHORT, PUSH_VALUE_LONG) && !anyLong(a, ['--recurse-submodules', '--no-recurse-submodules'])) {
      i++;
      continue;
    }
    if (a.startsWith('-') && a !== '-') flags.push(a);
    else positional.push(a);
  }
  const short = flags.filter((f) => /^-[A-Za-z]+$/.test(f)).join('');
  return {
    force: flags.some((f) => anyLong(f, ['--force', '--force-with-lease', '--force-if-includes'])) || short.includes('f') || positional.slice(1).some((r) => r.startsWith('+')),
    all: flags.some((f) => anyLong(f, ['--all', '--mirror', '--branches'])),
    noVerify: flags.some((f) => longOption(f, '--no-verify')),
    remote: positional[0] ?? null,
    refspecs: positional.slice(1),
  };
}

// git commit options that take the next word as their value (a message "-n" is not the flag).
const COMMIT_VALUE_SHORT = ['-m', '-F', '-C', '-c', '-t'];
const COMMIT_VALUE_LONG = ['--message', '--file', '--reuse-message', '--reedit-message', '--author', '--date', '--template', '--fixup', '--squash', '--cleanup', '--trailer', '--pathspec-from-file'];

// --no-verify (or a prefix of it), or -n alone or in a cluster of short flags before one that takes a value (-nm "x").
export function commitSkipsHooks(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') return false;
    if (longOption(a, '--no-verify')) return true;
    if (a.startsWith('--')) {
      if (takesValue(a, [], COMMIT_VALUE_LONG)) i++;
      continue;
    }
    if (COMMIT_VALUE_SHORT.includes(a)) {
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

// The branch a refspec writes to on the remote ("HEAD" means the current branch). git completes a short
// destination: "heads/main" and "refs/heads/main" are main.
export function pushTarget(refspec, current) {
  const spec = refspec.replace(/^\+/, '');
  const dst = spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec;
  const name = dst.replace(/^refs\//, '').replace(/^heads\//, '');
  return name === 'HEAD' || name === '@' ? current : name;
}

// Commands that would settle a diverged branch (or hide it): the person decides how (doc 14 §3).
function settlesDivergence(call) {
  if (['rebase', 'pull', 'merge', 'reset'].includes(call.sub)) return true;
  return call.sub === 'branch' && call.args.some((a) => a === '-u' || /^-[A-Za-z]*u/.test(a) || anyLong(a, ['--unset-upstream', '--set-upstream-to']));
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
    if (overridesHooks(call)) return reason('overriding core.hooksPath would skip the commit-msg and pre-push checks; leave the git hooks on.');
    if (diverged(state) && settlesDivergence(call)) {
      return reason(`${state.branch} has diverged from ${state.upstream}; the user decides how to settle it (rebase, merge or reset), so git ${call.sub} is blocked for the agent.`);
    }
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
