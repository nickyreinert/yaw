// Pure helpers of the github module (ADR-0027): ids, branch names, commit messages, PR body.
// Everything here validates strings that end up in git or gh arguments; nothing touches the disk.

export class NameError extends Error {}

export const COMMIT_TYPES = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
export const ISSUE_TYPES = ['feature', 'bug', 'chore', 'spike', 'epic'];

// "T-012" (local, both) or "#34" / "34" (github). Returns { kind, id, number }: id is how the task is
// written in branch names and footers ("T-012" or "34"); number is the issue number for kind "issue".
export function parseTaskId(text) {
  const t = String(text ?? '').trim();
  let m = /^T-(\d{1,6})$/.exec(t);
  if (m) return { kind: 'task', id: t, number: null };
  m = /^#?(\d{1,9})$/.exec(t);
  if (m && Number(m[1]) > 0) return { kind: 'issue', id: String(Number(m[1])), number: Number(m[1]) };
  throw new NameError(`"${t}" is not a task id (use T-012 or #34)`);
}

// The task mode decides which id form is valid (ADR-0010): github -> issue number, local/both -> T-NNN.
export function checkIdForMode(task, mode) {
  if (mode === 'github' && task.kind !== 'issue') throw new NameError('tasks are GitHub issues in this project; use the issue number (#34)');
  if ((mode === 'local' || mode === 'both') && task.kind !== 'task') throw new NameError('tasks are T-NNN in this project (ADR-0010); use T-012');
}

export function slugify(text, max = 40) {
  const s = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  if (s === '') throw new NameError('the slug is empty after cleaning; use letters or digits');
  return s;
}

export function checkCommitType(type) {
  if (!COMMIT_TYPES.includes(type)) throw new NameError(`unknown commit type "${type}" (${COMMIT_TYPES.join(', ')})`);
  return type;
}

// <type>/<id>-<slug>, e.g. feat/T-012-invite-flow or fix/34-login-crash (doc 14 §2, ADR-0010).
export function branchName({ type, task, slug }) {
  return `${checkCommitType(type)}/${task.id}-${slugify(slug)}`;
}

// The task id a branch carries, or null: "feat/T-012-invite-flow" -> T-012, "fix/34-x" -> 34.
export function taskFromBranch(branch) {
  const m = /^[a-z]+\/(T-\d{1,6}|\d{1,9})-/.exec(String(branch ?? ''));
  return m ? parseTaskId(m[1]) : null;
}

// "<type>(<scope>): <subject>" plus the task footer ("Refs T-012" / "Refs #34"; doc 14 §2 commit-msg rule).
export function commitMessage({ type, scope, subject, task }) {
  checkCommitType(type);
  if (scope !== undefined && !/^[a-z0-9][a-z0-9/-]{0,30}$/.test(scope)) throw new NameError(`invalid scope "${scope}" (lowercase letters, digits, - and /)`);
  const s = String(subject ?? '').trim();
  if (s === '') throw new NameError('the commit subject is empty');
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new NameError('the commit subject must be one line without control characters');
  if (s.length > 100) throw new NameError(`the commit subject has ${s.length} characters; keep it under 100`);
  const head = `${type}${scope ? `(${scope})` : ''}: ${s}`;
  return task ? `${head}\n\nRefs ${task.kind === 'issue' ? `#${task.id}` : task.id}` : head;
}

// Repository and owner names as GitHub accepts them.
export const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
export const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function checkRepoName(name) {
  if (!REPO_NAME.test(name) || name === '.' || name === '..' || name.startsWith('-')) throw new NameError(`"${name}" is not a valid repository name`);
  return name;
}

export function checkSemver(version) {
  const v = String(version ?? '').replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(v)) throw new NameError(`"${version}" is not a version (use 1.2.3 or 1.2.3-rc.1)`);
  return v;
}

// Fill the PR template (.github/pull_request_template.md): marker comments are replaced, the rest is kept.
// Without the markers the generated parts are put on top.
export function prBody({ template, commits, task }) {
  const summary = commits.length > 0 ? commits.map((c) => `- ${c}`).join('\n') : '- ';
  const closes = !task ? '' : task.kind === 'issue' ? `Closes #${task.id}` : `Refs ${task.id}`;
  let body = String(template ?? '');
  const hasSummary = body.includes('<!-- yaw:summary -->');
  const hasCloses = body.includes('<!-- yaw:closes -->');
  body = body.replace('<!-- yaw:summary -->', () => summary).replace('<!-- yaw:closes -->', () => closes);
  const top = [];
  if (!hasSummary) top.push(summary);
  if (!hasCloses && closes) top.push(closes);
  return `${top.length > 0 ? `${top.join('\n\n')}\n\n` : ''}${body}`.trimEnd() + '\n';
}
