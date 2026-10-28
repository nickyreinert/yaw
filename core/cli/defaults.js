// Personal defaults are independent of project setup and optional tool defaults.
import { collectQuestions, hasModule } from '../render/kit.js';
import { runInterview } from '../interview/engine.js';
import { isPreference } from '../interview/policy.js';
import { loadPreferences, saveSetup, secretFindings } from '../lib/user-store.js';
import { confirm } from './prompt.js';
import { UsageError } from './commands.js';

export async function defaults({ positionals, values, io }) {
  if (positionals.length) throw new UsageError('defaults takes no positional arguments');
  if (!io.prompter.interactive) {
    if (values.offer) return 0;
    throw new UsageError('Personal defaults need an interactive terminal; use Global Settings → Defaults in the browser.');
  }
  const preferences = loadPreferences({ env: io.env, kitRoot: io.kitRoot });
  if (preferences.warning) throw new UsageError(preferences.warning);
  if (values.offer) {
    if (preferences.hasDefaults) return 0;
    if (!(await confirm(io.prompter, 'Would you like to enter personal defaults now?'))) return 0;
  }
  const modules = ['core', ...(hasModule(io.kitRoot, 'communication') ? ['communication'] : [])];
  const questions = collectQuestions(io.kitRoot, modules).filter(isPreference);
  io.stdout.write('\nPersonal defaults: experience, chat language, autonomy and answer style. Project facts and optional tools are separate.\n');
  const result = await runInterview({ questions, mode: 'pro', defaults: preferences.answers, kitRoot: io.kitRoot, prompter: io.prompter });
  if (secretFindings({ answers: result.answers, kitRoot: io.kitRoot }).length) throw new UsageError('Personal defaults were not saved: an answer looks like a secret.');
  for (const [key, value] of Object.entries(result.answers)) io.stdout.write(`  ${key}: ${value}\n`);
  if (!(await confirm(io.prompter, 'Save these personal defaults for future projects?'))) return 0;
  const saved = saveSetup({ env: io.env, kitRoot: io.kitRoot, answers: result.answers, mode: 'pro', projectRoot: io.cwd, kit: '', preset: false, profile: true });
  if (!saved.saved) throw new UsageError('Personal defaults were not saved.');
  io.stdout.write('Saved personal defaults. Existing projects keep their own settings.\n');
  return 0;
}
