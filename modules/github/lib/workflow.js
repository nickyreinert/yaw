// Read-only planning first; callers obtain confirmation before applying any shared-state changes.
import { GhError } from '../../../core/lib/gh.js';

// One line of text from GitHub for display: no control characters.
const oneLine = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();

function json(text, what) {
  try {
    return JSON.parse(text);
  } catch {
    throw new GhError(`gh returned invalid JSON for ${what}`);
  }
}

function pages(gh, path) {
  const result = json(gh(['api', path, '--paginate', '--slurp']), path);
  if (!Array.isArray(result) || result.some((page) => !Array.isArray(page))) {
    throw new GhError(`gh returned unexpected pages for ${path}`);
  }
  return result.flat();
}

export function repository(gh) {
  const info = json(gh(['repo', 'view', '--json', 'nameWithOwner']), 'repository');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(info.nameWithOwner ?? '')) {
    throw new GhError('gh returned an unexpected repository name');
  }
  return { slug: info.nameWithOwner, owner: info.nameWithOwner.split('/')[0] };
}

// Open milestones and epics (native Epic type or type:epic) with their counts: one read, nothing is changed.
// -> { milestones: [{ title, closed, total, due }], epics: [{ number, title, done, total, milestone }] }
export function readProgress({ gh, repo }) {
  const milestones = pages(gh, `repos/${repo.slug}/milestones?state=open&per_page=100`).map((m) => ({
    title: oneLine(m.title), closed: m.closed_issues, total: m.open_issues + m.closed_issues, due: typeof m.due_on === 'string' ? m.due_on.slice(0, 10) : undefined,
  }));
  const epics = pages(gh, `repos/${repo.slug}/issues?state=open&per_page=100`)
    .filter((i) => !i.pull_request && (i.type?.name?.toLowerCase() === 'epic' || i.labels?.some((l) => (typeof l === 'string' ? l : l.name) === 'type:epic')))
    .map((i) => ({
      number: i.number, title: oneLine(i.title), done: i.sub_issues_summary?.completed ?? 0, total: i.sub_issues_summary?.total ?? 0,
      milestone: i.milestone?.title ? oneLine(i.milestone.title) : undefined,
    }));
  return { milestones, epics };
}

export function planProjectStatus({ gh, repo, project, issue, status }) {
  if (!Number.isSafeInteger(issue) || issue < 1) throw new GhError('Project updates require a positive issue number');
  const board = json(gh(['project', 'view', String(project.number), '--owner', repo.owner, '--format', 'json']), 'project');
  const fields = json(gh(['project', 'field-list', String(project.number), '--owner', repo.owner, '--format', 'json']), 'Project fields').fields;
  const field = fields?.find((f) => f.name === 'Status');
  const option = field?.options?.find((o) => o.name.toLowerCase() === status.toLowerCase());
  if (!board.id || !field?.id || !option?.id) throw new GhError(`project ${project.number} has no Status option "${status}"`);
  return {
    description: `${repo.slug}#${issue}: Project ${project.number} Status → ${option.name}`,
    apply() {
      const item = json(gh(['project', 'item-add', String(project.number), '--owner', repo.owner,
        '--url', `https://github.com/${repo.slug}/issues/${issue}`, '--format', 'json']), 'Project item');
      if (!item.id) throw new GhError('gh returned no Project item ID');
      gh(['project', 'item-edit', '--id', item.id, '--project-id', board.id, '--field-id', field.id, '--single-select-option-id', option.id]);
    },
  };
}

export function planEpicMilestones({ gh, repo, epics }) {
  if (!epics?.length) return [];
  const milestones = pages(gh, `repos/${repo.slug}/milestones?state=all&per_page=100`);
  const byTitle = new Map();
  for (const milestone of milestones) {
    if (byTitle.has(milestone.title)) throw new GhError(`milestone title "${milestone.title}" is ambiguous`);
    byTitle.set(milestone.title, milestone);
  }
  const assignments = new Map();
  const titles = new Set();
  for (const { issue, milestone } of epics) {
    const epic = json(gh(['api', `repos/${repo.slug}/issues/${issue}`]), `epic #${issue}`);
    const type = epic.type?.name?.toLowerCase();
    if (epic.pull_request || !(type === 'epic' || epic.labels?.some((l) => (typeof l === 'string' ? l : l.name) === 'type:epic'))) {
      throw new GhError(`#${issue} must be an Epic issue or carry type:epic before milestone sync`);
    }
    const children = pages(gh, `repos/${repo.slug}/issues/${issue}/sub_issues?per_page=100`);
    for (const item of [epic, ...children]) {
      if (!Number.isSafeInteger(item.number) || item.number < 1
        || item.html_url !== `https://github.com/${repo.slug}/issues/${item.number}`) {
        throw new GhError(`epic #${issue} contains a sub-issue outside ${repo.slug}; milestone sync refused`);
      }
      const previous = assignments.get(item.number);
      if (previous && previous.title !== milestone) throw new GhError(`#${item.number} maps to conflicting milestones`);
      assignments.set(item.number, { title: milestone, current: item.milestone?.title });
    }
    titles.add(milestone);
  }
  const operations = [...titles].filter((title) => !byTitle.has(title)).map((title) => ({
    description: `create milestone "${title}" in ${repo.slug}`,
    apply() {
      const created = json(gh(['api', '--method', 'POST', `repos/${repo.slug}/milestones`, '-f', `title=${title}`]), 'created milestone');
      if (!Number.isSafeInteger(created.number) || created.number < 1) throw new GhError('gh returned no milestone number');
      byTitle.set(title, created);
    },
  }));
  for (const [issue, { title, current }] of assignments) {
    if (current === title) continue;
    operations.push({
      description: `${repo.slug}#${issue}: milestone → "${title}"`,
      apply() {
        gh(['api', '--method', 'PATCH', `repos/${repo.slug}/issues/${issue}`, '-F', `milestone=${byTitle.get(title).number}`]);
      },
    });
  }
  return operations;
}
