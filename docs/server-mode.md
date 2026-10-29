# LAN server mode

Server mode is optional, off by default and configured separately on each machine in `yaw web` → Global → Settings → Features. Select **Host** or **Client**. Ordinary `yaw init` continues to initialize the current directory. It gains no Telegram interview or hosted destination.

## Host

Open `yaw web` in the folder that will hold your workspaces. Select Host, choose a concrete LAN interface and port, and confirm the absolute `<current-folder>/workspaces` path. Saving starts a background host and creates that directory. The saved root stays fixed when commands are later run elsewhere. A missing parent directory or symlink is refused.

`yaw host` opens the existing host interface, starting it if needed. It has no idle timeout; closing browser tabs and completing interviews leave it running. `yaw host --stop` stops the service and its managed agent processes. `yaw host --foreground` runs it under the terminal or a service manager instead. Do not run foreground and background instances together. Disabling Server mode stops its daemon and pauses migrated data; it does not silently restore the previous sync authority.

The host needs Node 22.13+, Linux or macOS, and a current Claude Code CLI supporting `remote-control --spawn=session`. A native terminal uses `/usr/bin/script` on Linux, or Python 3's standard-library PTY support on macOS; no Python packages are required. Sign into Claude on the host using `claude` and `/login`. Native Remote Control requires an eligible subscription; an API key is not a substitute. `YAW_CLAUDE_BIN` can select a trusted host-installed executable. No SDK package is installed by this workflow.

## Client

Enable Server mode, choose Client and enter the host address, for example `http://192.168.1.10:4318`. That is the only client configuration field. A background client requests pairing; approve **sync + init** in the host interface. Its scoped device credential is stored privately on the client. Revoke it on the host to stop further sync and initialization requests. Existing data-only pairings retain data-only access.

Both host and clients sync portable personal preferences, setup/module defaults, presets and saved session statistics every 30 seconds. Explicit Refresh status on the client also checks the connection. Statistics retain device provenance and existing deduplication; raw conversations, repositories, local paths, service configuration and credentials are excluded. This does not automatically scan native history. `yaw web` remains the local dashboard for inspecting collected and synced statistics.

Conflicts pause changes instead of silently choosing a winner. Resolve host conflicts in its interface, or use `yaw remote sync --resolve local|remote`; on a client, those choices mean that client's changes or the hub's changes. Existing folder/GitHub sync requires an explicit migration confirmation: run the old sync, stop its other writers, and back up the vault first. Current local records transfer to the hub; YAW does not silently import an old vault's uncollected records. Migrated scopes are excluded from folder/GitHub writers. Changing an existing hub's authority is a separate migration.

## Initialize a hosted project

| Command | Interview | Files |
| --- | --- | --- |
| `yaw init` | Existing CLI or local Web UI | Current directory |
| `yaw init-remote` | Client CLI or client Web UI | Configured host's workspace |
| `yaw init-local` | Host CLI or persistent host Web UI | Saved host workspace, from any current directory |

Examples:

```sh
yaw init-remote --slug notes
yaw init-remote --slug notes --web
yaw init-local --web
yaw init-local --slug notes --answers /path/to/answers.yaml --yes
```

Hosted commands also accept `--skip-verify`, an explicit choice to omit project setup/checks. `--web` cannot be combined with `--answers` or `--yes`. The browser can ask for the slug when omitted; terminal initialization asks for it before the questionnaire. Noninteractive initialization requires `--slug`, `--answers` and `--yes`.

The interview uses the existing questions, depths, presets, module policy, preview and apply validation. Client browser interviews display `yaw init-remote` and the host destination. Host browser interviews run in the existing host interface. Drafts live only in the host's temporary interview session, expiring after 30 minutes; no project directory exists before Apply. Project secrets must be entered privately on the host.

After confirmation, files go to `workspaces/<programming-language>/<slug>/`, for example `workspaces/python/notes/`. Slugs use lower-case letters, digits and single hyphens, at most 64 characters. The host revalidates every submission and exclusively creates the destination. Existing folders and symlinked path components are refused. Duplicate submissions do not launch another agent. Failed initialization leaves visible partial state for inspection; it is never overwritten or replayed automatically. An interrupted HTTP response can have an unknown result: inspect the host before retrying.

Hosted projects select exactly one agent: Claude Code in this version. Successful setup/checks, or explicit skip, launch one native Claude Remote Control process in that project. The host allows two concurrent native processes and one initialization at a time. It shows process state and the native Claude connection link. No initial coding prompt is sent: use Claude's own web/mobile interface for prompts and tool approvals.

Native workspace trust and Remote Control startup confirmations remain explicit in the host interface. A running process is not reported ready until its connection URL appears. Installation, login or unsupported CLI failures require attention on the host. YAW does not import or control arbitrary pre-existing CLI processes. Service restart marks previous sessions unknown and does not replay coding work or automatically relaunch them.

## Telegram, only on the host

Telegram questionnaires and supervision are available only inside an enabled Host service. They are not added to ordinary init or the other local interview entry points.

Create a dedicated bot through BotFather, start its private chat, and privately set `YAW_REMOTE_TELEGRAM_TOKEN` in the host service environment. Restart the host to pick up that environment. Use **Pair chat** and follow its five-minute one-time link. Only the paired private user/chat may issue commands; forwarded messages, groups and bots are refused.

```text
/init notes [quick|basic|all]
/status
/projects
/confirm <session-id>
/stop <session-id>
/cancel
```

`/init` runs the same questionnaire and an explicit final confirmation. Telegram supervises project/process state; coding prompts and coding approvals stay in Claude's interfaces. `/confirm` applies only to a pending native startup confirmation.

Native project-local hooks send bounded lifecycle metadata to the local host and print nothing. Notifications distinguish **Response finished**, **Task reported complete**, **Input required in Claude** and **Agent error**. Response completion is not proof that acceptance checks passed. Notifications are deduplicated per event/turn, background work suppresses premature Stop notifications, and no prompt or response text enters notifications. Telegram delivery is best effort; inspect service status for delivery gaps.

## Network and public-hosting boundary

This release supports a trusted LAN, including loopback. HTTP does not encrypt LAN traffic. Use a dedicated unprivileged host account and a network you trust. Native Claude has that account's filesystem/process permissions and its own permission checks; this workflow does not claim Linux worker isolation or multi-tenant containment.

Listeners bind only a selected current private IPv4 interface. Outbound connections pin DNS results and refuse public addresses, credentials in URLs and redirects. Requests enforce private peers, exact allowed Host and Origin, browser CSRF, expiring owner sessions, scoped revocable device credentials, bounded bodies, pairing/login limits and workspace containment. Forwarded proxy headers are rejected. The host retains at most 10,000 recent hub receipts; revisions still reject stale writes after old receipts expire. Initialization and native sessions have separate identities and no automatic execution retries.

Do not expose this service through port forwarding or a public proxy. Public hosting needs a separate reviewed mode with mandatory TLS, explicit external origins and trusted proxies, strong owner authentication, device authorization, account/process isolation, abuse limits, audit/retention policy and recovery tests. The LAN listener does not enable any of those implicitly.

## State and recovery

State stays under `YAW_HOME` (default `~/.yaw`) with private files. `remote-settings.json` holds role, port and the selected address/root/interface; `server-client.json` holds a client's private pairing credential and migration consent; `server-runtime.json` holds the daemon's local control credential. Never sync or share those credential files.

`remote-state.json` holds project/session lifecycle metadata, pairing hashes and Telegram ownership/offset. `remote-hub.json` holds authoritative portable records. `host-device.json`, `host-sync-state.json` and `hub-sync-state.json` retain sync identity/base and device observations. Native Claude keeps its own login and history on the host; YAW does not copy them to clients. A project-local `.claude/settings.local.json` adds quiet lifecycle hooks without replacing generated managed settings.

Back up the workspace, portable hub and native Claude state while the service is stopped. After a crash, `yaw host` can recover a dead service lock; it refuses a live/ambiguous lock. Review unknown sessions and partial projects through the host before resuming work in Claude. `yaw host` does not install a boot service: a service manager can run `yaw host --foreground` if automatic startup/restart is desired.

Pre-role `yaw remote serve` configurations retain their legacy SDK controller for compatibility; choosing Host uses this native workflow. See [the legacy service](remote-control.md) for its separate deployment and recovery requirements.

Protocol references: [Claude Remote Control](https://code.claude.com/docs/en/remote-control), [Claude hooks](https://code.claude.com/docs/en/hooks), [Telegram bots](https://core.telegram.org/bots).
