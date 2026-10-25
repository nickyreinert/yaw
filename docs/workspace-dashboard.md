# Workspace dashboard, notifications and session analysis

Run `yaw web` in any folder. It opens the dashboard without writing files or
starting setup; in an uninitialized folder, use **Workspace → Settings →
Interview** (or **Configure project** on the Overview) when you are ready to
configure it. `yaw web --background` keeps one shared dashboard server for all
your YAW workspaces: running `yaw web` in another workspace reopens that
server with the workspace selected. Switch workspaces in the sidebar's
**Project** list; each browser tab keeps its own choice. Use **Add project
folder** to add a workspace you have not opened yet; only folders with a YAW
setup are accepted. Use `yaw web --stop` before restarting the server with
changed environment variables.

## Scope and controls

The sidebar has two groups. **Workspace** covers only the selected workspace:

- **Overview**: this workspace's sessions, tasks and setup.
- **Sessions**: the session browser, locked to this workspace.
- **Settings** has three tabs:
  - **Interview**: the same questions as `yaw edit`, with your saved answers,
    setup depth, stack and modules. In a folder without YAW, it is the first
    setup instead: empty
    answers, **Set up project** writes the files; a folder that is not empty
    needs a confirmation first, and your home folder is refused. **Preview changes** lists every
    file that would change, with a diff; **Apply** writes them (files you
    edited yourself are kept). Apply is enabled only after a preview of the
    current answers, and is refused if `.yaw/answers.yaml` changed on disk.
  - **Files**: the files YAW wrote here, grouped by purpose (agent
    instructions, hooks and agent settings, recipes, YAW records). Click a file
    to read it in a panel pinned to the bottom: **Form** shows structured
    content (hooks table, recipes, YAW blocks versus your own text), **Raw**
    the source. Files are read-only here; `.env*` and secret files are never
    listed. Change tracking is git's job.
  - **Review prompts** (review module): what each review agent is told, one
    text per reviewer plus the shared reporting rules. **Save for this
    project** writes `.yaw/review/<kind>.md` (commit it, so the team and the
    push gate use it); **Use blueprint** removes it again.
  Notification preferences are personal, so they live under Global Settings.
- **Knowledge**: this workspace's knowledge records and decisions. Use
  **+ New record**, and **Edit** / **Delete** on a selected record.
  **Decision categories** edits `.decisions/taxonomy.json` (Form or Raw JSON);
  a category pair still used by a decision cannot be removed or renamed.
  `#knowledge/decisions` opens the list filtered to decisions.
- **Tasks**: this workspace's `TASKS.md`.
- **Code map** (only when the code-map module is enabled) reads the saved map.
  Run `yaw map update` to regenerate it and `yaw map check` to check it;
  opening the page does neither.

**Global** spans workspaces. One filter bar, pinned to the top while you
scroll, drives every card, chart and table on the page: folder, project, agent,
model, period (7/30/90 days, all, or a From/To range). **Split charts by**
stacks the charts by agent, model, folder or project; combine it with the
filters, for example one project split by agent.

- **Overview**: totals, a drill-down table of projects by folder, and charts.
  The drill-down root is the folder shared by your innermost projects; click a
  folder to go one level down, a project to filter by it. A project in a
  parent folder (such as your home folder) is listed as `./` or by full path.
- **Sessions**: usage and message-insight cards, then charts (sessions per
  week, duration, prompt and answer length, response time, tokens by model,
  outcomes), then the tables (sessions, lengths and timing, agents, models,
  folders, projects, outcomes). The sticky filter bar also holds **Refresh**,
  **Auto** and **Classify**, described below.
- **Tasks**: open tasks across projects, filterable by folder and project;
  **Open →** switches the dashboard to that project's Tasks page.
- **Knowledge**: your personal records in `~/.yaw/knowledge`. Other
  workspaces' knowledge is never shown. The same operations work in the
  terminal with `yaw knowledge` (see below).
- **Settings**: **Interview** edits your personal defaults
  (`~/.yaw/user-profile.yaml`; preview, then apply) and lists saved presets
  (view, rename, delete); **Files** shows `~/.yaw` read-only with a Form/Raw
  panel; **Notifications** holds the notification preferences and lists which
  projects have the comfort module; **Classification** holds the Laya settings
  and setup steps (see below); **Review prompts** edits your blueprint
  (`~/.yaw/review/<kind>.md`), which every project without its own prompt
  uses, and **Reset to kit default** removes it.

Every table can be filtered and sorted and is paged. Filters, splits, tabs,
table searches, sorting, pages and the open file are kept in the address
(`#global-sessions?period=30&split=project&sort.sessions=tokens.desc`), so a
view can be bookmarked and Back/Forward work. Workspace **Sessions** is the
same view locked to the current workspace.

## Sync between devices

Open **Global / Settings / Sync** to choose an existing folder (including a
mounted NAS) or an existing private GitHub repository, name this device, and
select settings, presets and/or statistics. Save, then press **Sync now**.
The same controls are available in the CLI:

```sh
yaw sync setup --folder /absolute/path/to/yaw-data --name Laptop
# Or use an existing private repository; Git and authenticated gh are required:
yaw sync setup --github owner/yaw-data --name Laptop
yaw sync run
yaw sync status
```

Configure the same destination on the other device with a different name,
such as `PC`. Use `--scopes settings,presets,statistics,tasks,knowledge` during setup to select
what participates (`tasks` and `knowledge` are off unless you list them). Setup does not exchange data; sync is manual. Device names
can be changed with `yaw sync run --name "Work laptop"`; identity stays stable.
Do not copy `sync-device.json` between installations.

Settings means personal interview defaults; presets means saved setups; statistics adds the other device's sessions to the Sessions pages; tasks adds its Global → Tasks snapshots (project folder name, task ids, titles, status); knowledge syncs the Markdown records in `~/.yaw/knowledge` both ways, deletions included (links, secret-looking files and files over 128 KiB stay local). Local
path, folder, directory, endpoint, host, URL and root answer fields stay local.
Other answers and preset descriptions are user-authored content: review them
before publishing. Existing workspaces are not reconfigured. Credential files,
notification channels, local classifier addresses, source code and native
sessions are not transferred. The destination stores portable records in
`yaw-sync.json` as plaintext; protect the folder/share and repository access.
Only private GitHub repositories are accepted, checked on every sync.

Edits merge against each device's last successful sync. Conflicting edits or
edit/delete pairs stop the exchange without applying portable records. The UI
offers **Keep local conflicts** / **Keep remote conflicts**; the CLI uses
`yaw sync run --resolve local` or `--resolve remote` (applies to all reported
conflicts). Deletion markers prevent previously synchronized presets from
reappearing. Conflict choices should be made after reviewing the local preset
and the destination's `yaw-sync.json`. Unrelated changes merge automatically.

Run **Refresh** on Sessions, or `yaw sessions scan`, before syncing to update
saved numerical summaries. Sync never reads native transcripts. Its statistics
view shows combined totals and a device selector, alongside each device's last
contribution. Only hashed session IDs and numeric token, cost, prompt/answer
counts and character sums travel; project paths, titles and message text do not.
Unknown usage stays unknown. The same session on several devices counts once
in the combined total, choosing the snapshot with the most messages; divergent
copies are not combined. Device subtotals can overlap. These totals are shown
in Sync; existing session charts continue to describe local saved history.

Local sync configuration, device identity and merge state live in the YAW data
directory (`YAW_HOME`, default `~/.yaw`). Settings and presets retain their
existing locations under `~/.yaw`. A disconnected destination fails without
changing local records or the merge base. The NAS must already be mounted;
YAW does not mount shares or create the chosen destination directory. Do not
unmount or replace a share during a sync. GitHub uses a dedicated local clone;
concurrent pushes can require resolving a diverged clone before retrying.
Destination changes are refused; use one dedicated destination across devices.

Locks prevent simultaneous local/folder exchanges. After a crash, check that no
sync is running before manually removing the empty `sync.lock` in the data
directory or `.yaw-sync.lock` in the destination. Symbolic-link paths are
refused; use canonical paths, e.g. `/private/tmp` on macOS rather than `/tmp`.
`yaw sync --check` retains its existing agent adapter drift check.

## Explicit collection

Opening, filtering or refreshing the dashboard reads saved results and YAW's
session registry, not native agent transcripts. To read historical transcripts:

```sh
yaw sessions scan                 # current workspace
yaw sessions scan --all --days 30 # discovered workspaces, last 30 days
yaw sessions analytics           # read saved current-workspace results
yaw sessions analytics --all     # read all saved results
```

In the dashboard, press **Refresh** in the filter bar of a Sessions page. On
**Global / Sessions** it reads all discovered workspaces; on **Workspace /
Sessions** only the open one. It uses the period chosen in the filter bar
(**All** means everything). Hover a button for a short explanation. Results persist
in `~/.yaw/session-analysis.json` (`YAW_HOME` overrides the directory), with
private file permissions. Only metadata, aggregate lengths/timing, a content
fingerprint, task snapshots and classification counts are saved: no conversation
text or transcript paths.

**Auto**, next to Refresh, is off by default and is a personal setting
(`~/.yaw/web-preferences.json`). When it is on, opening a Sessions page runs
Refresh once per page load with that page's scope. It never classifies. With
Auto off, opening or reloading a page only reads saved data.

Supported histories: Claude Code, Codex and Copilot CLI. This does not claim
coverage of VS Code chat storage. Discovery examines at most 20,000 files per
agent; inaccessible or unsupported files may be missed. Analysis reads
each transcript completely, whatever its size, streaming it line by line; lines
above 4 MiB and malformed records are skipped and flag the session as partial.
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

Or press **Classify** in the filter bar of a Sessions page (same scope as
Refresh) and confirm the message-reading prompt.

### Install Laya

YAW does **not** install Python packages, download weights or start a service.
[Laya](https://github.com/NandhaKishorM/laya) is an Apache-2.0 Python model
service; it needs Python 3.10+ and downloads its multilingual checkpoint (about
322M parameters) into the Hugging Face cache on first use (`HF_HUB_CACHE`
moves it). Review the model card and your disk and memory first. Install it in
its own virtual environment:

```sh
python3 -m venv ~/.laya
~/.laya/bin/python -m pip install "laya[serve]"
# or: uv venv ~/.laya --python 3.12 && uv pip install --python ~/.laya/bin/python "laya[serve]"
```

Start it bound to this computer only and keep the terminal open while you
classify:

```sh
LAYA_HOST=127.0.0.1 LAYA_PORT=8000 LAYA_MODELS=multilingual LAYA_DEFAULT_MODEL=multilingual ~/.laya/bin/laya-serve
```

By default `laya-serve` listens on all network interfaces (`0.0.0.0`); keep the
explicit `LAYA_HOST`. Add `LAYA_DEVICE=mps|cuda|cpu` to pick the device. YAW
does not support `LAYA_API_KEY`.

### Classification settings

**Global / Settings / Classification** shows these steps with copy buttons and
holds the settings, saved in `~/.yaw/web-preferences.json` and also used by
`yaw sessions evaluate` (`--endpoint` overrides the address):

| Setting | Default | Range |
|---|---|---|
| Laya address | `http://127.0.0.1:8000` | loopback HTTP only |
| Confidence threshold | 0.65 | 0.5–0.99 |
| Largest turn (UTF-8 bytes) | 5000 | 1000–32000 |
| Token budget (`max_len`) | 8192 | 512–32768, at least the largest turn |
| Timeout per turn (seconds) | 120 | 10–600 |

**Test connection** sends one fixed, made-up turn (never your history) and
reports whether Laya answered and how long it took. Only literal loopback HTTP
addresses are accepted; redirects and hosted endpoints are refused.

YAW sends eligible prompt/answer turns plus the next prompt to
`POST /v1/systemone`, selects `multilingual`, and requests the configured
`max_len` (Laya caps it with `LAYA_MAX_TOKEN_BUDGET`). Turns above the largest
turn size are skipped, never silently shortened. The service must confirm
untruncated multilingual inference and return valid choice probabilities.
Predictions below the threshold become `unknown`. Results count outcomes,
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

Under **Global / Settings / Notifications**, enable notifications and Telegram, choose the minimum
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

## Session folders

Global → Settings → Sessions lists the folders `Refresh` reads: Claude Code, Codex, Copilot CLI and Gemini CLI
histories. The usual folder of each agent is the default; the page suggests other places that exist on this machine
(XDG config, Flatpak, WSL) and lets you edit, disable, remove or add folders, each with the format of the tool that
wrote it. The choice is saved in `~/.yaw/session-sources.json`; `yaw sessions import` uses it too. Cursor, Antigravity
and VS Code Copilot Chat keep sessions in databases or binary formats and cannot be added yet.
