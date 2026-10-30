// Shared project rules for generated AGENTS.md, standards and the local-agent kickoff.
export function codingPractices(answers = {}) {
  const errors = answers['quality.error-detail'] === 'detailed'
    ? 'Give users clear error context, impact and recovery steps.'
    : 'Keep user-facing errors concise, actionable and consistent.';
  const output = { console: 'structured console logs', file: 'structured log files', both: 'structured console and file logs' }[answers['quality.log-output']] ?? 'structured console logs';
  const documentation = answers['quality.documentation'] === 'detailed'
    ? 'Maintain internal architecture, contracts, decisions, setup and troubleshooting documentation as behavior changes.'
    : 'Keep setup, public contracts, non-obvious decisions and recovery instructions current; explain intent rather than restating code.';
  return [
    answers['quality.unit-tests'] === true
      ? 'Unit tests are required: maintain a non-empty suite with meaningful assertions for project behavior and run it as part of just check. The Quality reviewer must report an empty, missing or failing unit-test suite as findings.'
      : 'Unit tests are optional: the Quality reviewer must not require a unit-test suite or report its absence as findings.',
    'Test changed behavior, boundaries, failure paths and security-sensitive checks; add regression tests for bugs. Report what could not be tested.',
    `${errors} Never swallow errors silently; keep stack traces out of public errors. Use ${output}; redact secrets and personal data.`,
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
