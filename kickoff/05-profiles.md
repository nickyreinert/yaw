# 05 — Profiles

A profile is a **stack building block**: how to set up, run, check, build, screenshot and deploy a given technology. The agent picks profiles from the idea; a project may combine several (e.g. `static-site` frontend + `cloudflare-workers` API). If nothing fits, the agent uses the closest profile and records the deviation as an ADR, or scaffolds a new profile (section 4).

## 1. Initial profiles

| Profile | Typical idea | Dev env | Gate (`just check`) | `just screenshot` | Deploy target | Guard patterns |
|---|---|---|---|---|---|---|
| `python-cli` | Script, tool, data job | `uv` venv, no Docker | `ruff`, `mypy`/`pyright`, `pytest`, `pip-audit` | n/a | none / PyPI | `twine upload` |
| `node-cli` | Node CLI/tool, zero-dependency where possible (used for YAW itself) | Node ≥ 22, no Docker | `node --test`, `tsc --checkJs` (optional), `npm audit` if deps, `shellcheck` for scripts | n/a | git tag / npm | `npm publish`, tag push |
| `python-web` | Flask/FastAPI app, self-hosted | Docker Compose (app + DB) | ruff, pyright, pytest, `alembic upgrade` on temp DB, `bandit`, pip-audit, image build | Playwright | Docker host via SSH / registry | prod migrations, `docker push`, `ssh prod` |
| `static-site` | Landing page, portfolio, docs | Vite or plain + nginx container | `html-validate`, `stylelint`, link check, Lighthouse budget | Playwright | nginx container / Cloudflare Pages / Netlify | remote deploy |
| `node-ts-vercel` | Next.js / Vite + TS app | Node, Vercel CLI, optional Docker DB | `tsc`, ESLint, Vitest, `next build`, Playwright e2e, `npm audit` | Playwright | Vercel (preview + prod) | `vercel --prod`, env changes |
| `cloudflare-workers` | Edge API, Worker + D1/R2/KV | Wrangler local (Miniflare) | `tsc`, Vitest (workers pool), local D1 migration, `wrangler deploy --dry-run` | Playwright (if UI) | Cloudflare | `wrangler deploy`, `wrangler secret`, `d1 … --remote` |
| `php-web` | Plain PHP or Laravel site | Docker Compose (php-fpm, nginx, MariaDB) | `phpstan`, `php-cs-fixer`, PHPUnit/Pest, `migrate --pretend`, `composer audit` | Playwright | shared hosting (rsync/SFTP) / Docker host | prod `artisan migrate`, rsync to prod |
| `wordpress-plugin` | WP plugin or theme | `wp-env` (Docker) | PHPCS + WPCS, PHPStan (WP stubs), PHPUnit, Plugin Check, `composer audit` | Playwright against wp-env | ZIP release / WordPress.org SVN | SVN commit, prod DB ops |
| `android-kotlin` | Android app (Compose) | Gradle, Android SDK, emulator (no Docker on macOS) | `ktlint`/`detekt`, Android Lint, unit tests, `assembleRelease` | Paparazzi or emulator + `adb screencap` / Maestro | Play Console tracks (Fastlane) | upload to production track, keystore access |

Candidates for later (one folder each): `expo-react-native`, `go-service`, `browser-extension`, `astro-content-site`, `django`.

Remote dev loop (doc 11 §4): `android-kotlin` implements `device-pair`, `device-install`, `device-screenshot`, `device-log`; all web profiles implement `preview` and `preview-share`.

## 2. Profile folder

```
profiles/python-web/
├── profile.yaml          # metadata, suggestWhen, defaults, applicable modules
├── standards.md          # ≤ 20 lines stack overlay
├── just/python-web.just  # implements the uniform verbs
├── env.example           # variable names for .env.example (optional, ADR-0025)
├── devenv/               # Dockerfile, compose.yaml, devcontainer.json (optional; the profile advises containers by having it)
├── ci/check.yml          # CI steps fragment (setup toolchain, cache, `just check`)
├── guards.yaml           # dangerous command patterns + reason
├── taxonomy.seed.json    # categories/keywords for the decision journal
├── visual.yaml           # screenshot method, routes/screens, viewports
├── scaffold/             # minimal starter (optional; skipped when repo has code)
└── tests/                # smoke test: render into temp dir, run `just check`
```

`profile.yaml`:

```yaml
name: python-web
summary: Flask or FastAPI web app, containerised, self-hosted.
suggestWhen:
  language: [python]
  runsOn: [self-hosted, docker]
  hasUI: [true, false]
options:
  framework: { choices: [flask, fastapi], default: fastapi }
  db: { choices: [none, sqlite, postgres], default: postgres }
defaults:
  modules: { backup: true, environments: true, ui-design: auto }
  budgets: { apiP95ms: 300 }
requires: [docker, just, uv]
```

## 3. Flexibility rules

- Profiles define **verbs and checks**, not application architecture. The architecture comes from the proposal and is recorded as ADRs.
- `options` cover common forks (framework, DB); they are offered with the full interview (step 7), step 3 renders the defaults (ADR-0020). Anything else: the agent adapts the generated files and records an ADR; the manifest marks those files `managed: false`.
- Combining profiles: each brings its own `just` fragment under a namespace (`just api::test`); the top-level verbs call all of them.
- Existing repos (retrofit): `yaw init --detect` inspects lockfiles/manifests to suggest profiles and skips `scaffold/`.

## 4. Adding a profile

`yaw profile new <name>` copies a template folder with all verbs stubbed as "not applicable". Done when: `profile.yaml` validates, `just check` passes in a project made from `examples/<name>/answers.yaml` (the smoke test runs `yaw init` on it in a temp folder), and the kit CI runs that test. Keep a profile small; if it needs more than ≈ 10 files, split options or move logic into a module.
