# YAW Remote

For Host/Client roles, workspace provisioning and native Claude Remote Control, use [LAN server mode](server-mode.md). This page describes the pre-role SDK controller retained for compatibility.

Remote Control is **off by default**. Enable it on each participating machine in `yaw web` → **Global → Settings → Features**, then save. Enabling permits the feature; start the service separately with `yaw remote serve`. Its browser interface is available through an SSH tunnel, or commands through a paired private Telegram chat. Managed agents work in registered checkouts on the server. Closing the browser leaves them running; stopping the service stops its workers.

While disabled, the command is hidden from normal CLI help, service startup and hub-client operations are refused, and provider adapters are not loaded by ordinary CLI commands. No remote service, worker or Telegram polling starts automatically. Turning the setting off shuts down a running controller and its workers. Its metadata and configuration remain available for a later opt-in. Previously migrated hub datasets remain paused rather than silently reverting to folder/GitHub authority.

This is an initial implementation of YAW Remote. The browser, controller, hub protocol and adapters have automated fixture coverage. Actual NAS compatibility and real provider approvals must be verified on the deployment host before relying on unattended work. Public hosting, proxy authentication, multi-user access, adoption of existing processes and durable conversation replay are outside this version.

## Host and provider setup

The hub runs on Node 22.13+ without runtime dependencies. Managed execution additionally requires Linux x64/ARM64, executable local storage, working unprivileged user namespaces, **bubblewrap** at `/usr/bin/bwrap`, and the build tools your projects need. A NAS that cannot run this Linux environment can still store a portable vault, but cannot run these workers. Start with at least 4 GiB RAM and size memory and storage for your builds. `YAW_REMOTE_BWRAP` can name another absolute bubblewrap executable.

Use a dedicated unprivileged service account. Keep its state and execution homes on a local filesystem, not a shared SMB/NFS home. Give it only the development checkouts it needs. Execution checkouts must be separate from the controller kit and state directories; overlapping paths are rejected. Use a separate clone to work on YAW itself. Provision filesystem quotas for checkouts and worker homes: the controller bounds its own buffers and files, but an agent's build can create arbitrary files within its writable checkout and home.

Each worker has a private process namespace and home, a writable checkout at `/work`, a read-only kit at `/opt/yaw`, read-only operating-system tools and temporary storage. It cannot see the controller home or unrelated shares. Workers share the host network so they can reach their model provider; this is filesystem/process isolation, not a network firewall. Restrict access to unrelated services at the host/network layer where required. No unsandboxed fallback is available.

Choose either or both adapters:

| Adapter | Install on the Linux host | Authentication |
| --- | --- | --- |
| Claude | In the kit, `npm ci --prefix adapters/remote-claude --ignore-scripts --no-audit --no-fund`. The optional SDK is pinned to 0.3.312 in its own package. | Enter `ANTHROPIC_API_KEY` privately in the service environment. Subscription-based native Remote Control remains a separate alternative. |
| Codex | Install an official Linux Codex CLI; set `YAW_REMOTE_CODEX_BIN` to its native Linux executable path, rather than an npm JavaScript/shell launcher that needs sibling files. | Enter `OPENAI_API_KEY` privately in the service environment. The isolated worker does not import a MacBook sign-in. |

Claude uses the [official streaming SDK](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) and [tool/input callbacks](https://code.claude.com/docs/en/agent-sdk/user-input). Codex uses the [official app-server protocol](https://learn.chatgpt.com/docs/app-server), over worker-local stdio. Prompts are protocol input, never shell command strings. SDK/project settings, skills and hooks are loaded from the registered project; validate that their executable paths work inside `/work`. Provider credentials and native histories stay on this host. The adapter interface is described below.

Enter a strong random `YAW_REMOTE_OWNER_TOKEN` of at least 32 characters privately on the NAS, then start:

```sh
yaw remote serve --port 4318
```

The service prints its loopback URL, with no credential in it. The saved Features port is used when `--port` is omitted. Sign in using the owner credential. Browser sessions expire after 12 hours; **Sign out all browsers** revokes all current sessions. Rotating the owner credential requires restarting the service, which also revokes browser sessions. Paired-device credentials are separately revocable and do not grant execution control.

On your MacBook, preserve the same local and remote port:

```sh
ssh -N -L 4318:127.0.0.1:4318 your-nas
```

Open `http://127.0.0.1:4318`. Exact loopback Host and Origin checks remain active. A reverse proxy or NAS hostname is not a supported access mode. No public listener is opened, and the existing `yaw web` transport remains separate.

## Browser workflow

1. Initialize a checkout on the NAS with `yaw init`. In **Manage hub**, register its absolute server path. This creates a stable project ID; a path from another device does not register anything implicitly.
2. Select **New**, choose a registered project, an available agent and optionally a model. Enter a prompt and start the session.
3. Follow activity and assistant messages. The checkout change list includes changes that existed before the turn; it is not an automatic diff attribution system.
4. Resolve tool requests once with **Allow this action once** or **Deny**. For questions, select a suggested choice or type your answer. The request shows its session, turn, proposed input and expiry.
5. Send another message when the turn is idle. Busy turns reject additional prompts. **Interrupt turn** asks the provider to interrupt; **Stop worker** ends the worker and releases its workspace. Neither undoes edits or external effects.
6. After a restart or stopped instance, **Resume exact session** uses its recorded provider ID and original worker home, plus a new explicit prompt. Inspect unknown deliveries before resending.

Only sessions launched by YAW Remote are controllable. Existing session analytics remain separate. One managed worker owns a registered checkout, including while idle; register separate checkouts for parallel editing. Use independent clones initially: external worktree metadata paths outside the mounted checkout are unavailable to the isolated worker. There is no automatic merge, push, deployment or checkout removal.

Defaults: two workers, a 30-minute active-turn deadline, five-minute decision expiry, 24,000-character prompts, 200 live events / 256 KiB per session, 500 session records and 20,000 command receipts. Claude additionally has a $10 SDK budget and 100 model turns per worker instance. Codex cost limits are not exposed by this adapter; cost is unknown. Use provider/account budgets and service resource limits. Limits are host constants/options, not permissions the browser or agent can raise.

## Telegram

Use a dedicated bot, with no webhook and no other polling consumer. Enter `YAW_REMOTE_TELEGRAM_TOKEN` privately in the service environment before starting it. In **Manage hub**, pair your numeric Telegram user ID and private chat ID. For a private user chat, those IDs must match. Usernames, groups, bots and forwarded messages cannot authorize commands.

```text
/projects
/sessions
/status
/new <project-id> claude <prompt>
/new <project-id> codex <prompt>
/send <session-id> <prompt>
/resume <session-id> <prompt>
/interrupt <session-id>
/stop <session-id>
/decision <session-id> <request-id>
/approve <session-id> <request-id>
/deny <session-id> <request-id>
/answer <session-id> <request-id> {"question ID or text":"answer"}
```

Every command names its target explicitly. `/decision` must successfully deliver the precise action details before Telegram can approve or answer it. Long or secret-looking requests require the authenticated browser. Approval state is shared: a request resolved in one channel cannot be reused in another, and expired requests deny permission. Provider-native permission rules can allow some actions without invoking a callback; YAW does not claim that every tool call requires approval.

Telegram shows concise state changes and bounded final output. Outbound updates are rate-limited with a bounded temporary queue; overflow/delivery failures appear in the browser's Telegram status. The bot follows the [official update/offset protocol](https://core.telegram.org/bots/api#getupdates). Acceptance offsets are persisted before dispatch, so a crash can produce an unknown delivery rather than repeat an action. Telegram is not a durable prompt queue or a transcript mirror.

## Data hub and migration

Shared settings, presets, statistics and opt-in task/knowledge records use the existing portable schemas and secret checks. Task snapshots remain observations; they are not writable copies of another machine's task ledger. Repositories, credentials, native histories and raw execution content do not enter hub sync.

For an existing vault, stop its writers, back it up, then use **Manage hub → Import a portable vault** to import `yaw-sync.json` into an empty hub. Pair each device with **Pair device**, copy its credential once, and enter it privately in `YAW_HUB_TOKEN` on that device. The service stores only the credential hash. A paired credential grants read/write access to portable datasets, not browser login or agent control.

Enable Remote Control in that client's Global Settings too, then configure it through its SSH tunnel:

```sh
yaw remote sync --hub http://127.0.0.1:4318 --scopes settings,presets,statistics --migrate
yaw remote sync
yaw remote status
```

Omit `--migrate` for a device with no overlapping folder/GitHub sync scopes. Tasks and knowledge require explicit inclusion in `--scopes`. `--token-env NAME` selects another credential environment variable name; credentials themselves are never command arguments or stored in client configuration. Reconfiguring a client must retain previously migrated scopes; switching authority requires a separately planned migration.

The server assigns revisions and rejects stale writes with HTTP 409. Clients perform three-way merges against their last accepted base. Review reported record conflicts and choose `yaw remote sync --resolve local` or `--resolve remote` explicitly. Deletions use null markers. Each paired device can publish only its own observation slot, preserving provenance; overlapping statistics retain the existing deduplication behavior. Clients keep unsent local edits during an outage and do not elect another authority.

Once configured, the folder/GitHub transport excludes migrated scopes and refuses attempts to reconfigure them there. Other scopes may still use that transport. Never point an authoritative hub and writable folder clients at the same dataset after migration. The hub does not watch the old vault after import.

## Service installation and recovery

An example [systemd user/account service](yaw-remote.service) starts YAW at boot, restarts on failure, limits memory/processes and stops the full worker process group. Review paths, Node version, account permissions and quotas before installing it. Create its private environment file yourself; do not commit it or share its contents. Installing/enabling the service is an administrator action, not performed by `yaw remote serve`.

State lives under `YAW_HOME` (default `~/.yaw`):

| File/directory | Contents |
| --- | --- |
| `remote-state.json` | Projects, managed/provider IDs, lifecycle states, hashed device credentials, command receipt metadata, Telegram pairing and update offset. No prompts, responses or tool inputs. |
| `remote-hub.json` | Authoritative portable records, revisions, device observations, deletion markers and receipt fingerprints. User-authored text is plaintext, as in existing sync. |
| `remote-workers/<session-id>/` | Each provider's private native home/history. Excluded from portable sync; subject to the provider's own content-retention behavior. |
| `remote.lock` | Exclusive service PID lock. A dead PID can be recovered at startup; a live/reused PID or invalid lock requires inspection. |
| `remote-settings.json` | Machine-local enabled switch and controller port. Missing, invalid or unreadable settings mean disabled. This opt-in is never included in portable sync. |

Browser connections do not own worker lifetimes. Service restarts terminate managed workers through bubblewrap/process supervision; metadata becomes **unknown**, pending decisions are invalidated, and no prompt is replayed automatically. Resume only through the original managed session and native ID. Live output is held in bounded memory; a changed service epoch or expired buffer reports a gap. There is no durable conversation replay or exactly-once provider execution guarantee.

Back up the two metadata JSON files, provider worker homes and Git checkouts together while the service is stopped. Keep secret environment files in your separate private backup process. Restore under the same service account into a separate test location, start the service with a fresh owner credential, and verify revisions, device provenance and exact-session recovery before replacing a live service. A file-sync copy or RAID is not a restore test.

## Adapter contract and validation

`executionAdapters()` exposes trusted, host-installed adapters by ID. Each declares `input`, `resume`, `interrupt`, `approvals`, `questions`, `files` and `available`, then implements `start({ session, project, onEvent, request }) → { send, interrupt, stop }`. Provider events are normalized to session identifiers, messages, activity, changed-file observations and lifecycle events. A decision promise resolves only for the current YAW session/turn/request. Unknown protocol requests fail closed. Browser input cannot supply adapter executable paths or shell commands.

Claude's optional package is checked against its installed TypeScript declarations. The Codex integration uses stable JSON-RPC methods and was checked against schema output from the installed CLI. Neither adapter exposes hidden reasoning. Add another provider only after verifying its protocol and running the shared supervisor contract tests.

Run `node --test test/remote-control.test.js test/data-sync.test.js` for routing, authentication, revocation, approvals, duplicate commands, restart handling, migration and adapter fixtures. `just check` remains the project gate. Before deployment, run a real agent on the actual Linux host: verify project guidance, start/follow-up/resume by ID, a real approval, interruption, browser disconnect, workspace exclusion, bot revocation and restart recovery. This repository's fixture tests do not establish those host/provider facts.

Architecture: ADR-0069. Existing hook/registry/sync decisions ADR-0007, ADR-0018, ADR-0029 and ADR-0061 remain applicable.
