# Agent-driven setup

Run `yaw init --api` in the target project folder. This starts the same local setup service as `yaw init --web` without opening a browser. A coding agent can conduct the interview, configure answers, inspect the generated file plan, and apply the confirmed configuration. No LLM provider is called by YAW. This is a REST interface; a native MCP transport is not included.

The service binds to loopback, expires after 30 minutes of inactivity, and stops after Apply or Ctrl+C. Existing folder guards and verification apply. `--skip-verify` is available for explicit use; `--api` cannot be combined with `--web`, `--answers` or `--yes`.

## Authentication

Use the one-time login link printed by `yaw init --api` privately. Make a GET request to that exact link without following redirects automatically, retain the returned session cookie, then GET `/` with that cookie. Extract the `yaw-csrf` meta value from the HTML. Send the cookie on every request and that value as `X-YAW-Token` on every POST, with `Content-Type: application/json`. Do not log credentials or put them in command arguments. Browser access to the same link uses the existing login flow.

Host and Origin checks, CSRF protection, the 256 KiB JSON limit, answer validation, secret filtering and the single Apply lock are shared with the browser service. Remote or public access is not supported.

## Interview sequence

1. GET `/api/bootstrap` for question labels, help, types, choices, defaults, modules and dependencies. Use those choices as the catalogue; do not infer answer keys from labels.
2. GET `/api/setup` for `{ revision, setup }`. The initial setup contains explicit answers only. Defaults are proposals, not confirmation of missing project facts.
3. Interview the user. POST `/api/setup-update` with the current revision and a complete replacement setup object. Partial interviews are valid. Updates stay in memory; a stale revision returns 409 and invalid input returns 400 without changing state.
4. GET `/api/setup` and POST its `setup` object to `/api/preview`. Review `unresolved`, effective answers, selected modules and every file action with the user. `/api/diff` accepts the same body. Nothing is written by these actions.
5. POST that exact reviewed `setup` object to `/api/apply` only after the user confirms writing it. Incomplete or unconfirmed essential answers are rejected. Read the response as newline-delimited JSON: `log`, `kickoff`, `error` and `done` events. Check `done.ok`; the HTTP status alone does not prove success. Apply runs normal setup/check recipes unless explicitly skipped.
6. POST `/api/setup-prompts` with the reviewed setup before Apply to obtain `{ interview, kickoff }`, or use `localPrompt` from Apply's `kickoff` event. Pass the final kickoff to the local coding agent to create Architecture, Data Model and UI/UX directly in the target project. No reply import is needed.

Example update body (use the actual revision):

```json
{
  "revision": 0,
  "setup": {
    "mode": "quick",
    "answers": {
      "user.agents": ["codex"],
      "idea.text": "An offline reading tracker for one person.",
      "arch.language": "javascript",
      "arch.runs-on": "local",
      "tasks.use-github": false
    },
    "gitInit": false
  }
}
```

`modules` may be omitted to use setup policy or supplied as a complete list including `core` and every dependency. `gitInit` must be explicitly true to request repository creation through this interface. Use `mode: "pro"` for All; `quick` and `basic` are also supported. Explicit answers survive depth changes. Saved personal defaults are separate from project facts.

GET `/api/bootstrap` exposes the latest API setup as `handoff`, so opening or reloading the wizard displays it. An already-open browser keeps its unsaved local edits until reloaded; concurrent browser and agent editing is not a live collaborative session. Always submit the exact setup that was reviewed to preview and Apply.
