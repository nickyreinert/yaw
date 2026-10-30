# Archive

- T-003 Profile options: let a profile offer a choice that selects its scaffold, starting with TypeScript x app-store
  model: sonnet · effort: high
  acceptance: No profile-option mechanism exists yet (profile.yaml comments only mention it). Design it (ADR): option in profile.yaml, question in the interview and browser form, answer stored, render picks the matching scaffold variant, a pair still picks exactly one profile. First use: TypeScript x app-store with the most common frameworks (Capacitor, Expo/React Native, Electron, Tauri); the user decides in the interview. A framework is a library, so the interview must say that it overrides "prefer built-in" for this choice. Each variant needs a smoke-tested gate that runs without Xcode, the Android SDK or signing. Needs the web UI updated; coordinate with other work in core/web.
  done: ADR-0105 (options in profile.yaml -> question arch.<profile>-<option>, scaffold variants/<choice>/), ADR-0106 (node-app: capacitor, expo, electron, tauri; smoke-tested per variant, CI matrix).

- T-002 Rename the language id "javascript" to "typescript"
  model: sonnet · effort: medium
  acceptance: The UI card says TypeScript but the stored id is javascript. Rename the id in interview/base.yaml, every profile.yaml, examples, tests and docs; keep reading old answers files and saved presets that say javascript (map to typescript). Do before more TypeScript profiles are added.
  done: ADR-0103; id is typescript everywhere, core/interview/legacy.js reads old javascript answers, presets, API input and plan replies.
