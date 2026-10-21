#!/bin/sh
# Team mode (team module, ADR-0031): nobody pushes to the default branch; changes reach it through a pull request.
# lefthook runs this for pre-push with the remote name in $1 and git's ref lines on stdin.
remote="${1:-origin}"
default="$(git symbolic-ref --quiet --short "refs/remotes/$remote/HEAD" 2>/dev/null || true)"
default="${default#"$remote"/}"
status=0
while read -r _ _ rref rsha; do
  [ -n "$rref" ] || continue
  branch="${rref#refs/heads/}"
  if [ -n "$default" ]; then
    [ "$branch" = "$default" ] || continue
  else
    case "$branch" in main | master) ;; *) continue ;; esac
  fi
  # Creating the branch (the first push of a new repository) is fine; updating or deleting it is not.
  case "$rsha" in *[!0]*) ;; *) continue ;; esac
  echo "team mode: pushing to the default branch $branch is blocked; push an issue branch and open a pull request (just pr)" >&2
  status=1
done
exit "$status"
