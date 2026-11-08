// Shared project rules for generated AGENTS.md, standards and the local-agent kickoff.
// Error, logging and documentation rules are not user options (T-031): they follow the language, the destination
// and the enabled modules. context.modules is known only where files are rendered.
export function codingPractices(answers = {}, { modules = [] } = {}) {
  const page = answers['arch.language'] === 'html' || answers['arch.runs-on'] === 'static';
  const errors = 'Keep user-facing errors concise, actionable and consistent. Never swallow errors silently; keep stack traces out of public errors.';
  const logging = page
    ? 'No logging infrastructure: no logger, log files or log retention; show failures in the page and keep console output out of production code.'
    : 'Use structured console logs (stdout/stderr), no log files unless the platform requires them; redact secrets and personal data.';
  const documentation = modules.includes('code-map')
    ? 'Keep setup, public contracts, non-obvious decisions and recovery instructions current; docs/code-map.md describes what each part of the code does, so do not restate the file layout elsewhere.'
    : 'Keep setup, public contracts, non-obvious decisions and recovery instructions current; explain intent rather than restating code.';
  return [
    answers['quality.unit-tests'] === true
      ? 'Unit tests are required: maintain a non-empty suite with meaningful assertions for project behavior and run it as part of just check. The Quality reviewer must report an empty, missing or failing unit-test suite as findings.'
      : 'Unit tests are optional: the Quality reviewer must not require a unit-test suite or report its absence as findings.',
    'Test changed behavior, boundaries, failure paths and security-sensitive checks; add regression tests for bugs. Report what could not be tested.',
    `${errors} ${logging}`,
    `${documentation} Follow the stack formatter, linter and type checks; validate external inputs and use parameterized queries.`,
  ];
}

export function architecturePractices(answers = {}) {
  const wrapper = answers['arch.wrapper'] ?? 'just';
  const wrappers = { off: 'Do not add an application command wrapper; document native installation, running, checks and build commands.', shell: 'Use project.sh as the shell entry point for common project commands.', just: 'Use just as the command wrapper for installation, running, checks and builds.', make: 'Use Make as the command wrapper for installation, running, checks and builds.' };
  return [
    wrappers[wrapper],
    answers['arch.library-strategy'] === 'prefer-libraries'
      ? 'Use suitable maintained libraries when they simplify the solution.'
      : 'Prefer standard-library features; justify external dependencies. Do not invent cryptography or authentication.',
    ...(['local', 'self-hosted', 'serverless'].includes(answers['arch.runs-on']) ? [answers['arch.docker'] === true
      ? 'Docker is required: document its purpose, build, configuration and non-root execution; keep checks reproducible.'
      : 'Docker is not required: keep development and checks usable without it.'] : []),
  ];
}
