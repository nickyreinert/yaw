// Optional module choices, after the project and stack questions.
import { GROUPS } from '../interview/module-groups.js';
import { PLAIN } from './style.js';

export async function chooseInitModules({ prompter, definitions, defaults = [], answers = {} }) {
  const style = prompter.style ?? PLAIN;
  const optional = definitions.filter((d) => d.name !== 'core');
  const groups = [...GROUPS.map(([key, title]) => [key, title]),
    ...[...new Set(optional.map((d) => d.group ?? 'other'))].filter((key) => !GROUPS.some(([id]) => id === key)).map((key) => [key, key])];
  const choices = [];
  prompter.show(`\n${style.bold('Your workflow · Optional modules')}\n  Project rules (core) are required. GitHub follows the repository choice.\n`);
  for (const [key, title] of groups) {
    const members = optional.filter((d) => (d.group ?? 'other') === key);
    if (!members.length) continue;
    prompter.show(`\n  ${style.bold(title)}\n`);
    for (const d of members) {
      const blocked = d.appliesTo?.usesGitHub === true && answers['tasks.use-github'] === false;
      const selected = defaults.includes(d.name) ? ' [selected]' : '';
      const number = blocked ? '–' : `${choices.push(d)})`;
      prompter.show(`      ${style.cyan(number)} ${d.title ?? d.name} (${d.name})${blocked ? ' · needs GitHub' : selected}\n`);
      prompter.show(`         ${d.short ?? d.description}\n`);
      const dependencies = (d.depends ?? []).filter((name) => name !== 'core');
      if (dependencies.length) prompter.show(`         Requires: ${dependencies.join(', ')}\n`);
    }
  }
  const available = new Set(choices.map((d) => d.name));
  const current = defaults.filter((name) => available.has(name));
  for (;;) {
    prompter.show(`\n      ${style.dim('Numbers or names, comma-separated · all · none')}\n      ${style.dim('(? help, w switch to browser)')}\n`);
    const reply = (await prompter.ask(`      Modules [${current.join(', ') || 'none'}] > `,
      { choices: [...available, 'all', 'none', 'w'], start: -1 })).trim();
    if (['w', 'web'].includes(reply.toLowerCase())) return { web: true };
    if (reply === '?') { prompter.show('      Enter keeps selected modules. Dependencies are included and shown in the file review.\n'); continue; }
    if (!reply) return { modules: current };
    if (reply.toLowerCase() === 'none') return { modules: [] };
    if (reply.toLowerCase() === 'all') return { modules: [...available] };
    const picked = reply.split(',').map((token) => {
      const value = token.trim().toLowerCase();
      return /^\d+$/.test(value) ? choices[Number(value) - 1]?.name : value;
    });
    if (picked.some((name) => !available.has(name))) {
      prompter.show('      Choose listed numbers or names, all, none, or w.\n');
      continue;
    }
    return { modules: [...new Set(picked)] };
  }
}
