// Shared project rules for generated AGENTS.md, standards and the local-agent kickoff.
export function codingPractices(answers = {}) {
  const errors = answers['quality.error-detail'] === 'detailed'
    ? 'Give users clear error context, impact and recovery steps.'
    : 'Keep user-facing errors concise, actionable and consistent.';
  const output = { console: 'structured console logs', file: 'structured log files', both: 'structured console and file logs' }[answers['quality.log-output']] ?? 'structured console logs';
  const documentation = answers['quality.documentation'] === 'detailed'
    ? 'Maintain internal architecture, contracts, module responsibilities, decisions, setup, operation and troubleshooting documentation as behavior changes.'
    : 'Keep setup, public contracts, non-obvious decisions and recovery instructions current; explain intent rather than restating code.';
  return [
    answers['quality.unit-tests'] === true
      ? 'Unit tests are required: maintain a non-empty suite with meaningful assertions for project behavior and run it as part of just check. The Quality reviewer must report an empty, missing or failing unit-test suite as findings.'
      : 'Unit tests are optional: the Quality reviewer must not require a unit-test suite or report its absence as findings.',
    'Test changed behavior, business rules, boundaries, failure/recovery paths and security-sensitive checks; add regression tests for bugs. Use appropriate unit/integration/interaction tests and run just check. Do not substitute coverage percentages or implementation-mirroring tests for useful assertions; report what could not be tested.',
    `${errors} Handle expected failures explicitly; do not silently swallow errors or turn failures into success. Keep stack traces and implementation details out of public errors. Use ${output} with severity, safe context and correlation IDs where useful; redact secrets and personal data. Bound and rotate file logs, protect access and document retention; logging failures must not leak data or hide the original error.`,
    `${documentation} Keep functions cohesive and files focused; split by responsibility rather than arbitrary line counts. Follow the stack formatter, linter and type checks; validate external inputs, use parameterized queries and transactions where applicable, and avoid custom cryptography.`,
  ];
}

export function architecturePractices(answers = {}) {
  return [
    answers['arch.library-strategy'] === 'prefer-libraries'
      ? 'Use suitable maintained libraries when they simplify the solution; assess licensing, security, maintenance and dependency cost before adding them.'
      : 'Prefer standard-library features and small, maintainable project code; justify external dependencies. Use vetted security-sensitive components instead of inventing cryptography or authentication.',
    ...(['local', 'self-hosted', 'serverless'].includes(answers['arch.runs-on']) ? [answers['arch.docker'] === true
      ? 'Docker is required: document its development/runtime purpose, build, configuration, networking, persistence, non-root execution and reproducible checks; implement the appropriate container setup in the target project after architecture review.'
      : 'Docker is not required: keep normal development and checks usable without Docker; preserve any established container setup unless an agreed change replaces it.'] : []),
  ];
}
