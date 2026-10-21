// Missing external tools of a selected module are a warning with an install hint, never an error (ADR-0026, ADR-0008).

import { spawnSync } from 'node:child_process';

// module -> tools its generated files use, with the install hint (same texts as the module recipes).
const MODULE_TOOLS = {
  'git-hooks': [
    { tool: 'lefthook', hint: 'brew install lefthook, or see https://lefthook.dev/installation/' },
    { tool: 'gitleaks', hint: 'brew install gitleaks' },
  ],
};

function onPath(tool) {
  const r = spawnSync(tool, ['--version'], { stdio: 'ignore' });
  return !r.error && r.status === 0;
}

export function printToolHints(out, modules) {
  for (const m of modules) {
    for (const { tool, hint } of MODULE_TOOLS[m] ?? []) {
      if (!onPath(tool)) out.write(`  warning: ${m} needs ${tool}, which is not installed; install ${tool}: ${hint}\n`);
    }
  }
}
