#!/bin/zsh
set -euo pipefail

CENTRAL_HOST="${TODOIST_CENTRAL_HOST:-flagg}"
CENTRAL_BIN="${TODOIST_CENTRAL_BIN:-/Users/joel/.local/bin/todoist-cli}"

quoted=()
for argument in "$@"; do
  quoted+=("$(printf '%q' "$argument")")
done

command="$CENTRAL_BIN"
if (( ${#quoted[@]} > 0 )); then
  command+=" ${(j: :)quoted}"
fi

exec /usr/bin/ssh \
  -o BatchMode=yes \
  -o ConnectTimeout=10 \
  "$CENTRAL_HOST" \
  "$command"
