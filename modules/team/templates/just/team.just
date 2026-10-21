# team module (ADR-0031): the documented first command when the agent has no session-start hook.

# Fetch, fast-forward when safe, and list my issues and pull requests (team mode, doc 14 §3).
start:
    @if command -v yaw >/dev/null 2>&1; then yaw session-start; elif [ -f "${YAW_KIT:-$HOME/.yaw/kit}/bin/yaw" ]; then node "${YAW_KIT:-$HOME/.yaw/kit}/bin/yaw" session-start; else echo "start: the YAW kit is not installed"; exit 1; fi
