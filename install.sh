#!/usr/bin/env bash
# YAW installer (doc 01 §4, ADR-0006).
# Clones or updates the kit in ~/.yaw/kit and links the yaw CLI into ~/.local/bin.
# It checks prerequisites and prints install hints, but never installs anything and never uses sudo.
# Running it again with the same options changes nothing.
#
#   install.sh                  latest release tag (or the channel used before)
#   install.sh --tag v0.1.0     a specific tag (CI installs the tag pinned in .yaw/manifest.json)
#   install.sh --channel main   bleeding edge
#
#   YAW_REPO=<git URL or local path>   kit source (default: https://github.com/nickyreinert/yaw.git)

set -euo pipefail

REPO="${YAW_REPO:-https://github.com/nickyreinert/yaw.git}"
YAW_HOME="$HOME/.yaw"
KIT="$YAW_HOME/kit"
BIN_DIR="$HOME/.local/bin"
LINK="$BIN_DIR/yaw"

say() { printf '%s\n' "$*"; }
fail() {
  printf 'install.sh: %s\n' "$*" >&2
  exit 1
}

usage() {
  say "usage: install.sh [--tag <tag> | --channel main]"
  say "  Installs the YAW kit into $KIT and links yaw into $BIN_DIR."
  say "  YAW_REPO=<git URL or path> selects another kit source."
}

tag=""
channel=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag)
      [ $# -ge 2 ] || fail "--tag needs a value"
      tag="$2"
      shift 2
      ;;
    --tag=*)
      tag="${1#--tag=}"
      shift
      ;;
    --channel)
      [ $# -ge 2 ] || fail "--channel needs a value"
      channel="$2"
      shift 2
      ;;
    --channel=*)
      channel="${1#--channel=}"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) fail "unknown option: $1 (see --help)" ;;
  esac
done
if [ -n "$channel" ] && [ "$channel" != main ]; then fail "--channel accepts only main"; fi
if [ -n "$tag" ] && [ -n "$channel" ]; then fail "use either --tag or --channel"; fi
case "$tag" in
  "" | v*) ;;
  *) tag="v$tag" ;;
esac

# 1. Prerequisites: report, never install.
missing=0
if ! command -v git >/dev/null 2>&1; then
  say "missing: git (macOS: xcode-select --install or brew install git; Linux: your package manager, e.g. sudo apt install git)"
  missing=1
fi
if ! command -v node >/dev/null 2>&1; then
  say "missing: node >= 22.13 (https://nodejs.org, or with nvm: nvm install 22)"
  missing=1
elif ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'; then
  say "too old: node $(node --version), YAW needs >= 22.13 (https://nodejs.org, or with nvm: nvm install 22)"
  missing=1
fi
if [ "$missing" -ne 0 ]; then fail "install the tools above, then run install.sh again (it installs nothing itself)"; fi
if ! command -v just >/dev/null 2>&1; then
  say "note: just is not installed; YAW projects use it (macOS: brew install just; Linux: https://just.systems/man/en/packages.html)"
fi

# 2. Clone, or fetch into the existing clone.
mkdir -p "$YAW_HOME"
if [ -d "$KIT/.git" ]; then
  git -C "$KIT" fetch --quiet --force --tags origin
  fetched="fetched"
elif [ -e "$KIT" ]; then
  fail "$KIT exists but is not a git checkout; move it away and run install.sh again"
else
  git clone --quiet -- "$REPO" "$KIT"
  fetched="cloned"
fi
if [ -n "$(git -C "$KIT" status --porcelain)" ]; then
  fail "$KIT has local changes; commit or discard them, then run install.sh again"
fi

# 3. Pick the version: --tag, --channel main, the channel used before, or the latest release tag.
if [ -z "$tag" ] && [ -z "$channel" ] && [ "$(git -C "$KIT" config --get yaw.channel || true)" = main ]; then
  channel=main
fi
if [ "$channel" = main ]; then
  ref="origin/main"
  mode="main"
elif [ -n "$tag" ]; then
  git -C "$KIT" rev-parse -q --verify "refs/tags/$tag" >/dev/null || fail "tag $tag not found in $REPO"
  ref="$tag"
  mode="tag"
else
  ref="$(git -C "$KIT" tag --list 'v[0-9]*' --sort=-v:refname | sed -n 1p)"
  [ -n "$ref" ] || fail "no release tag yet; run install.sh --channel main"
  mode="tag"
fi
new="$(git -C "$KIT" rev-parse "$ref^{commit}")"
old="$(git -C "$KIT" rev-parse HEAD)"
if [ "$new" != "$old" ] || [ "$(git -C "$KIT" rev-parse --abbrev-ref HEAD)" != HEAD ]; then
  git -C "$KIT" checkout --quiet --detach "$new"
  switched="checked out $ref"
else
  switched="already at $ref"
fi
if [ "$(git -C "$KIT" config --get yaw.channel || true)" != "$mode" ]; then
  git -C "$KIT" config yaw.channel "$mode"
fi
version="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$KIT/package.json")"

# 4. Link the CLI.
mkdir -p "$BIN_DIR"
target="$KIT/bin/yaw"
if [ -L "$LINK" ] && [ "$(readlink "$LINK")" = "$target" ]; then
  linked="link already in place: $LINK"
elif [ -e "$LINK" ] || [ -L "$LINK" ]; then
  linked="warning: $LINK exists and is not a link to $target; left it alone"
else
  ln -s "$target" "$LINK"
  linked="linked $LINK -> $target"
fi

# 5. Report.
say "yaw $version: $fetched $KIT, $switched (channel: $mode)"
say "$linked"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "add this line to your shell profile: export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac
say "check: yaw doctor    uninstall: yaw self-uninstall"
