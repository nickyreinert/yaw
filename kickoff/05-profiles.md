# 05 — Profiles

A profile is a **stack building block**: how to set up, run, check, build, screenshot and deploy a given technology. The agent picks profiles from the idea; a project may combine several (e.g. `static-site` frontend + `cloudflare-workers` API). If nothing fits, the agent uses the closest profile and records the deviation as an ADR, or scaffolds a new profile (section 4).

## 1. Initial profiles

| Profile | Typical idea | Dev env | Gate (`just check`) | `just screenshot` | Deploy target | Guard patterns |
|---|---|---|---|---|---|---|
| `python-cli` | Script, tool, data job | `uv` venv, no Docker | `ruff`, `mypy`/`pyright`, `pytest`, `pip-audit` | n/a | none / PyPI | `twine upload` |
| `node-cli` | Node CLI/tool, zero-dependency where possible (used for YAW itself) | Node ≥ 22, no Docker | `node --test`, `tsc --checkJs` (optional), `npm audit` if deps, `shellcheck` for scripts | n/a | git tag / npm | `npm publish`, tag push |
| `python-web` | FastAPI app, self-hosted (Flask and a database come with the full interview; ADR-0035) | `uv` venv; Dockerfile (no Compose yet) | ruff, pyright, pytest, `bandit`, pip-audit; `just build` = image build, not in `check` (no `alembic` yet) | n/a (no Playwright screenshot; ADR-0035) | Docker host via SSH / registry | prod migrations, `docker push`, `ssh prod` |
| `static-site` | Landing page, portfolio, docs | Vite or plain + nginx container | `html-validate`, `stylelint`, local link check (no Lighthouse budget; ADR-0034) | n/a (no Playwright screenshot; ADR-0034) | nginx container / Cloudflare Pages / Netlify (`preview-share` is not in this profile) | remote deploy |
| `node-ts-vercel` | TypeScript app with serverless functions for Vercel (Next.js / Vite options come with the full interview; ADR-0036) | Node (no Vercel login needed) | `tsc`, ESLint, Vitest, `npm audit --omit=dev` (no `next build`; ADR-0036) | n/a (no Playwright; ADR-0036) | Vercel, production only via `just deploy` (user-run, never CI; no preview deploys; ADR-0036) | `vercel` (any form), `vercel --prod`, env changes |
| `cloudflare-workers` | Edge API, Worker (D1/R2/KV bindings come with the full interview; ADR-0039) | Wrangler local only (`wrangler dev --local`, Miniflare) | `wrangler types` + `tsc`, ESLint, Vitest (Workers runtime), `npm audit --omit=dev`; no `wrangler deploy --dry-run`, no local D1 migration yet, no remote call (ADR-0039) | n/a (no Playwright; ADR-0039) | Cloudflare, production only via `just deploy` (user-run, never CI; ADR-0039) | `wrangler` (every form except local `dev`, `types`, `check`, `docs`, `--version`, `--help` and `d1`/`kv`/`r2` with `--local`), `--remote`, `just deploy`, `.dev.vars` |
| `php-web` | Plain PHP site (Laravel and the database come with the full interview; ADR-0037) | `composer` (PHP >= 8.2); no Docker Compose yet | `php-cs-fixer`, `phpstan`, PHPUnit, `composer audit --locked` (no Pest, no `migrate --pretend`; ADR-0037) | n/a (no Playwright; ADR-0037) | shared hosting / Docker host (`deploy` is inert; no rsync or SFTP recipe yet) | `artisan migrate` (except `--pretend`), rsync/ssh/sftp to a host, `docker push` |
| `wordpress-plugin` | WP plugin (themes come with the full interview; ADR-0038) | `composer` (PHP >= 8.2); `wp-env` (Docker) on demand via `just dev` | PHPCS + WPCS, PHPStan (WP stubs), PHPUnit, `composer audit --locked`; Plugin Check runs by hand in wp-env, not in `check` (ADR-0038) | n/a (no Playwright; ADR-0038) | WordPress.org SVN / ZIP by the user (`deploy` is inert; no ZIP recipe yet) | SVN commit and other SVN writes, deploy/release scripts, wp-cli against a remote site (`@alias`, `--ssh`) and `wp db reset/drop/import`, rsync/ssh/sftp to a host |
| `android-kotlin` | Android app (Compose; one `app` module, ADR-0040) | Gradle wrapper (pinned), JDK 17+, Android SDK (`ANDROID_HOME`); the emulator is started by the user (`just dev` installs the debug build; no Docker) | `ktlint`, `detekt`, Android Lint (debug), compile, JVM unit tests (JUnit 4); no `assembleRelease` (a release build needs the user's keystore; `just build` = `assembleDebug`), no emulator or device test, needs the SDK (ADR-0040) | n/a (no Paparazzi, `adb screencap` or Maestro yet; ADR-0040) | Play Console tracks (Fastlane) by the user only (`deploy` is inert and refuses in CI; no Fastlane recipe yet) | `./gradlew publish*` / `promote*`, `bundle*Release`, `install*Release`, signing properties and `sign*` tasks, `apksigner`, `jarsigner`, `keytool` (except `-help`, `-printcert`, `-version`), `fastlane` (all but informational forms) and `bundle exec fastlane`, bare `supply`/`deliver`, `gcloud`, `bq`, `adb install` of a release build; keystores and `keystore.properties` are secret files |

Candidates for later (one folder each): `expo-react-native`, `go-service`, `browser-extension`, `astro-content-site`, `django`.

Runner for `android-kotlin` (ADR-0040): the gate needs the Android SDK but no emulator, so CI runs on `ubuntu-latest` (JDK 21, no KVM). The job installs the SDK with `android-actions/setup-android` into `~/android-sdk` and caches it with the Gradle caches (`actions/cache`); a macOS runner works the same way and is not needed. The device verbs below (`device-*`) are phase 3 and not part of the verb set yet.

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
  runsOn: [self-hosted]   # ADR-0035; hasUI is not listed (no information)
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
- Combining profiles (ADR-0041): with two or more profiles each is a `just` module named after the profile (`just static-site::build`, `just cloudflare-workers::deploy prod`), its scaffold and recipes live in `<profile>/`, and the root `justfile` defines the uniform verbs, each calling that verb of every profile (`just check` fails when the gate of any profile fails; `sync-check` runs once at the root). `dev` and `preview` only list the namespaced commands, because each starts a server. Guards, standards and CI steps of all profiles apply. List the profiles in `proposal.profiles` (`examples/composed/` combines `static-site` and `cloudflare-workers`). No command changes the profile list yet: edit `proposal.profiles` in `.yaw/answers.yaml` and `profiles` in `.yaw/manifest.json`, then `yaw update`; this removes exactly the dropped profile's `just` module, `mod` line and `.gitignore` block, and its folder stays as your code. The remaining profile is then rendered flat (recipes run at the root) while its code stays in `<profile>/`: move it to the root yourself. Composition was tested with just 1.59.0; the minimum version that supports `set working-directory` and `mod::recipe` dependencies is not verified, and the kit does not check the version.
- Existing repos (retrofit): `yaw init --detect` inspects lockfiles/manifests to suggest profiles and skips `scaffold/`.

## 4. Adding a profile

`yaw profile new <name>` copies a template folder with all verbs stubbed as "not applicable". Done when: `profile.yaml` validates, `just check` passes in a project made from `examples/<name>/answers.yaml` (the smoke test runs `yaw init` on it in a temp folder), and the kit CI runs that test. Keep a profile small; if it needs more than ≈ 10 files, split options or move logic into a module.
