# Workspace dashboard, notifications and session analysis

Run `yaw web` in a YAW workspace. `yaw web --background` keeps one shared
dashboard server for all your YAW workspaces: running `yaw web` in another
workspace reopens that server with the workspace selected. Switch workspaces in
the sidebar's **Project** list; each browser tab keeps its own choice. Use
**Add project folder** to add a workspace you have not opened yet; only folders
with a YAW setup are accepted. Use `yaw web --stop` before restarting the
server with changed environment variables.

## Scope and controls

- **Overview** contains only the current workspace's sessions, tasks and setup.
- **Global / Projects, Sessions, Tasks** provides cross-workspace overviews.
  Sessions and tasks have project filters.
- **Knowledge** shows your personal (global) knowledge and the selected
  workspace's knowledge, never another workspace's. Use **+ New record**, and
  **Edit** / **Delete** on a selected record. The same works in the terminal
  with `yaw knowledge` (see below).
- **Notifications** edits personal notification preferences. The comfort module
  must be enabled in each workspace where its hooks should run.
- **Code map** reads this workspace's saved map. Run `yaw map update` to regenerate
  it and `yaw map check` to check it; opening the page does neither.

## Explicit collection

Opening, filtering or refreshing the dashboard reads saved results and YAW's
session registry, not native agent transcripts. To read historical transcripts:

```sh
yaw sessions scan                 # current workspace
yaw sessions scan --all --days 30 # discovered workspaces, last 30 days
yaw sessions analytics           # read saved current-workspace results
yaw sessions analytics --all     # read all saved results
```

The web equivalent is **Global / Sessions / Refresh saved session data**.
Choose current or all discovered workspaces and a date range. Results persist
in `~/.yaw/session-analysis.json` (`YAW_HOME` overrides the directory), with
private file permissions. Only metadata, aggregate lengths/timing, a content
fingerprint, task snapshots and classification counts are saved: no conversation
text or transcript paths.

**Refresh session data whenever this web interface reloads** is unchecked by
default and saved separately per workspace. Opting in explicitly allows
all-discovered-workspace collection on reload. It never runs classification.
An ordinary page refresh still just reads saved data when this option is off.

Supported histories: Claude Code, Codex and Copilot CLI. This does not claim
coverage of VS Code chat storage. Discovery examines at most 20,000 files per
agent; inaccessible or unsupported files may be missed. Analysis reads the
first 64 MiB and at most 2,000 text messages of each transcript; longer
histories and malformed/oversized records get a partial coverage flag.
Unreadable transcripts are skipped and counted instead of failing the scan.
Rescans reuse the saved row of every transcript whose size and modification
time are unchanged (stored as a hash of the path, never the path itself), so
only new or changed files are read again; classification always rereads. A
failed collection leaves the previously saved results untouched.

Profiling includes prompt/answer counts, Unicode character lengths, median/p95
answer length, and prompt-to-first-recorded-answer intervals. Those intervals
are not model inference latency. Session duration includes idle time, not just
active work. Missing usage/cost stays unknown. Distribution and combined
elapsed-time/answer-count charts supplement the existing comparisons.
Global tasks are snapshots from discovered session workspace roots; this is
not a filesystem-wide search for every possible project.

## Local Laya classification (experimental)

Classification is separate and always explicit:

```sh
yaw sessions evaluate --days 30
yaw sessions evaluate --all --endpoint http://127.0.0.1:8000
```

Or use **Classify sessions with local Laya** and confirm the message-reading
prompt. The address saved in the web preferences is also the CLI default.
Only literal loopback HTTP addresses are accepted; redirects and hosted
endpoints are refused.

YAW does **not** install Python packages, download weights or start a service.
If you choose to provision it yourself, follow the
[upstream Laya instructions](https://github.com/NandhaKishorM/laya) for the
`laya[serve]` extra, then run its separate service with a loopback bind:

```sh
LAYA_HOST=127.0.0.1 LAYA_MODELS=multilingual LAYA_DEFAULT_MODEL=multilingual laya-serve
```

The upstream default bind may expose the service on your network; keep the
explicit `LAYA_HOST`. Review the upstream model license and resource needs
before downloading anything.

YAW sends eligible prompt/answer turns plus the next prompt to
`POST /v1/systemone`, selects `multilingual`, and requests `max_len:8192`.
Turns above 5,000 UTF-8 bytes are skipped, never silently shortened. The service
must confirm untruncated multilingual inference and return valid choice
probabilities. Predictions below 0.65 become `unknown`. Results count outcomes,
sentiment, assistant behaviour and failure types per session; they are not
verified task-success measurements. No raw model response or message text is
saved. A fresh scan retains classifications only when its message fingerprint
is unchanged.

## Telegram and comfort

`yaw add comfort` enables the module **in the current project**. Quick leaves it
optional; Full includes it by default. It is not necessary to rerun Full:

```sh
yaw add comfort
yaw web
```

Under **Notifications**, enable notifications and Telegram, choose the minimum
run duration, and set the **names** of the environment variables containing your
bot token and chat ID. Defaults are `YAW_TELEGRAM_BOT_TOKEN` and
`YAW_TELEGRAM_CHAT_ID`. Enter credentials privately in your shell, not in the
web form, repository or chat. They must be present when YAW or the agent starts;
restart an already-running background web server to pick them up.

Use **Send test notification** to explicitly send a test. YAW sends only its
closed notification payload, never code, diffs or conversation text.
The safe environment-variable references and preferences are stored in
`~/.yaw/notification-settings.json`; credentials are not stored there or
returned by the API. These preferences apply to all comfort-enabled projects
without changing their unrelated hygiene/status-line choices.
`comfort.yaml` remains user-managed and read-only for YAW; existing ntfy
configuration continues to work. Remote background delivery status appears
in the notification panel. Terminal tests remain available with
`yaw notify test`.

## Editing knowledge

Records are Markdown files. Global records live in
`~/.yaw/knowledge/<namespace>/` (default namespace `personal`); project records
live in `docs/knowledge/`, `docs/spec/` and `.decisions/`.

```sh
yaw knowledge list [--global|--project] [--query TEXT]
yaw knowledge show <record>
yaw knowledge add "Prefer uv" --global --type rule --tag python --body "Use uv."
yaw knowledge add "API notes" --spec --file notes.md   # project docs/spec
yaw knowledge edit <record> [--file PATH]               # default: $VISUAL / $EDITOR
yaw knowledge remove <record> [--yes]
```

A record is named by its displayed path or its file name without `.md`.
Saving refuses secret-looking text and file names, symbolic links and files
over 128 KiB. If the file changed since you opened it, the save stops instead of
overwriting. Deleting asks for confirmation. Create decision records with
`yaw decisions record`; editing or deleting one here rebuilds the decision
index.
