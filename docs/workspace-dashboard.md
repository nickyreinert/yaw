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
scroll, drives every session card, chart and table on the page: folder,
project, device, agent, model, period (7/30/90 days, all, or a From/To range).
The device selector shows **All devices**, **This device**, and synced device
names. Synced sessions have no project path; the overview groups them by
device instead of counting them as projects. The overview's open-task count is
project data and is not affected by the session device filter. **Split charts
by** stacks the charts by agent, model, folder or project; combine it with the
filters, for example one project split by agent.
The programming-language filter uses each project's configured stack language,
falling back to the most common local source-file extension or recognizable
project manifests. Detection examines at most 2,000 entries, four folders deep,
without reading file contents, hidden folders, dependencies or symlinks.
Ties appear as **Mixed**; unavailable projects, synced sessions and projects
without recognizable evidence remain **Unknown**. This describes the current
project, not its historical state or the human language of the conversation,
and applies to all visible metrics, charts and tables.

- **Overview**: totals, a drill-down table of projects by folder, and charts.
  The drill-down root is the folder shared by your innermost projects; click a
  folder to go one level down, a project to filter by it. A project in a
  parent folder (such as your home folder) is listed as `./` or by full path.
- **Sessions**: usage and message-insight cards, then charts (sessions per
  week, duration, prompt and answer length, response time, tokens by model,
  outcomes), then the tables (sessions with lengths and timing, agents, models,
  folders, projects, outcomes). The sessions table distinguishes project from
  device. The sticky filter bar also holds **Refresh** and **Auto**, described
  below; classification starts from the controller on **Profiling**.
- **Profiling**: classified projects and sessions, highlighted conversations, and browser or configured CLI reviews (below). Workspace → Profiling is the same page limited to this workspace's sessions.
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
  uses, and **Reset to kit default** removes it. **Features** switches the
  optional features, each on by default: **Server mode**, **Settings Sync**
  (off hides the **Sync** tab) and **Profiling**, which covers Classification
  and the reviews, two steps of one feature (Classification labels sessions,
  reviews look at the ones that need attention). Profiling off hides **Profiling**
  (Global and Workspace), the **Profiling** settings tab (classifier and reviewers), the Classify controller and the
  Analytics **Classification** table and chart; links, the sidebar search and
  typed addresses no longer reach them. Saved settings and results are kept.

Every table can be filtered and sorted and is paged. Filters, splits, tabs,
table searches, sorting, pages and the open file are kept in the address
(`#global-sessions?period=30&split=project&sort.sessions=tokens.desc`), so a
view can be bookmarked and Back/Forward work. Workspace **Sessions** is the
same view locked to the current workspace.

### Global → Profiling

Open **Global → Profiling** (or **Workspace → Profiling** for this workspace only) to find a project or session that could teach you something. The same filters and sortable/searchable tables as Sessions apply here. Charts use already saved classification results, preserving unknown and mixed labels. **Needs attention** lists sessions with estimated friction or unresolved work; **All classified** and **All sessions** let you recognize work you remember. The **View** switch chooses how to browse, with the same data and filters in both: **Folder Browser** (default) lists the folders and projects one level at a time, with **Back** and the folder path, and shows a project's sessions once you open it; **All Sessions** is one flat list. The Folder Browser location is kept in the page address.

The Classify controller above the filter bar chooses how many sessions to process: **5**, **10** or **All** (default 5), then **Classify** starts the run; **Profiling settings** opens the settings. It takes the unclassified local sessions matching the current filters, newest first, capped at the chosen number; **All** takes every one of them. When none is unclassified, **Reclassify** takes the matching local sessions the same way. The server runs one job per request, so there is no batching beyond that cap. Classification is explicit, uses loopback Laya, and retains Pause, Resume and Stop. Missing or unreadable transcripts are skipped individually, with a count; existing results for those sessions remain available. If none can be read, no model runs. Check **Global → Settings → Sessions** for history-folder locations, or **Refresh** for a new scan; classifier settings do not restore missing histories. Unrelated saved sessions remain unchanged. Synced records contribute statistics but cannot open a transcript on this device.

Click **Read conversation** to authorize reading that session. The conversation opens in place of the list, one level down; **← Back to sessions** returns to the list without leaving the page. Above the list, **Signal** narrows it to sessions with a saved label (Admitted error, Frustrated, Aggressive, Unresolved). In the conversation, **Show** keeps only the turns with one phrase hint (Corrections, Apology / mistake, Recovery) plus one turn either side and counts the hidden messages. You see the chronological dialogue, with corrections highlighted in gold, apologies/mistakes in pink and recovery in green. **Previous clue** and **Next clue** jump between possible friction signals. These are phrase hints, not confirmed errors. The transcript is read up to 8 MiB or 1,000 messages; partial or unavailable evidence is identified. Larger Gemini JSON files cannot be opened in this bounded reader. Recognized absolute paths are redacted initially; other sensitive details may remain.

**Review this conversation** prepares relevant moments and their context automatically. Inspect and redact the editable prompt, then **Copy review prompt** and **Open ChatGPT**, Claude or another browser chat. This reuses the interview's destinations and sends no prompt in the link. The requested answer is one verdict sentence and up to three actions within 150 words. You decide which suggestion to apply.

To use a coding agent directly, configure **Global → Settings → Profiling**: enable an installed **Claude Code** or **Codex** CLI and select your default destination. Choose it in the review panel and press **Run review with CLI**. Confirmation identifies the deliberate disclosure: the CLI uses your sign-in and may send the prompt to a paid hosted provider. YAW starts a fresh, restricted review and displays the result here, without applying changes. Claude uses bare mode without tools; Codex excludes user config and uses an ephemeral read-only session with shell tools, apps, hooks and delegation disabled. Unsupported CLI versions or missing sign-in fail visibly. Vendor references: [Claude CLI](https://code.claude.com/docs/en/cli-reference), [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive), [Codex feature configuration](https://learn.chatgpt.com/docs/config-file/config-basic).

Stop a CLI review at any time; it times out after three minutes. Prompt size is capped at 24,000 characters and output at 32,000. YAW stores no conversation text, review prompts or verdicts (there is no saved-verdicts history) in analytics, registry, sync or logs. Temporary reviews clear when you leave Profiling, change filters or refresh; server verdicts expire after 15 minutes. Provider-side retention is separate. See ADR-0065.

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
contribution. The Global overview and Sessions views have their own device
filter; choosing one recalculates every session metric, chart and table for
that device, while **All devices** combines them. Only hashed session IDs and
numeric token, cost, prompt/answer counts and character sums travel; project
paths, titles and message text do not.
Unknown usage stays unknown. The same session on several devices counts once
in the combined total, choosing the snapshot with the most messages; divergent
copies are not combined. Device subtotals can overlap. These totals are shown
in Sync; Global overview and Sessions also include other-device sessions and
let you filter the session metrics by device.

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

If Refresh reports a request error, check the browser's network panel and
ad-blocker log. Extensions such as uBlock Origin can block the dashboard's
local requests; allow the local dashboard site and retry.

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

Or choose 5, 10 or All in the controller on **Global → Profiling** (or
**Workspace → Profiling**), press **Classify** and confirm the message-reading prompt. While it runs, the expandable
sidebar status shows session/turn progress and offers **Pause after current
turn**, **Resume**, and **Stop**. Stop aborts the active local request and
discards the unfinished run; only a completed run replaces saved evaluations.

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
| Shared prompt guidance | Classify the coding assistant response using only the supplied conversation. | 1–4,000 characters |

**Test connection** sends one fixed, made-up turn (never your history) and
reports whether Laya answered and how long it took. Only literal loopback HTTP
addresses are accepted; redirects and hosted endpoints are refused.

The shared prompt guidance is editable and applied to each classification
category; YAW continues to add its category labels and safety instructions.
The **Try Laya on saved sessions** preview lists up to 30 recent sessions from
the last Refresh. Select up to three and confirm to send up to three eligible
turns per session to the local Laya service, using the current form values
(saved or not). It shows short prompt/answer excerpts, Laya's top label and
model confidence, the applied label, its source, and any UNKNOWN reason. Preview
excerpts and predictions are temporary and are not saved. This is prompt
calibration, not model training: it does not update Laya's weights or teach it
from your choices. Use **Save** to keep prompt guidance for later evaluation.

YAW sends eligible prompt/answer turns plus the next prompt to
`POST /v1/systemone`, selects `multilingual`, and requests the configured
`max_len` (Laya caps it with `LAYA_MAX_TOKEN_BUDGET`). The preceding prompt and
answer are also included when they fit in the same byte limit; optional context
never causes an otherwise eligible turn to be skipped. Turns above the largest
turn size are skipped, never silently shortened. The service must confirm
untruncated multilingual inference and return valid choice probabilities.
For outcome only, narrow English/German whole-message user verdict rules apply
inside the existing classifier: for example, "that works" means `fulfilled`,
"still broken" means `not_fulfilled`, and "cancel this task" means `abandoned`.
Missing feedback and bare thanks remain `unknown`. Quotes, qualifications and
additional requests do not match these rules; Laya handles those cases with
explicit outcome criteria. Model predictions below the unchanged threshold become
`unknown`. A rule never fabricates a model confidence: the preview retains the
original model label and confidence alongside the applied label and source.
Other classification categories continue to use Laya.

Profiling shows aggregate UNKNOWN reasons: model uncertainty, threshold rejection,
or no user verdict. Older evaluations may have no recorded reason; use
**Reclassify** on the matching local sessions to update them. Refresh alone does
not reclassify. Only aggregate reason and rule-use counts are saved.
Results count outcomes,
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
