#!/usr/bin/env bash

set -euo pipefail

[[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:-} ]]
[[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:-} ]]
[[ -z ${TAILOR_PLATFORM_TOKEN:-} ]]
[[ -z ${TAILOR_TOKEN:-} ]]
[[ -z ${TAILOR_PLATFORM_PROFILE:-} ]]
[[ -z ${NODE_OPTIONS:-} ]]
[[ -z ${NODE_PATH:-} ]]
[[ -z ${TAILOR_PLATFORM_URL:-} ]]
[[ -z ${PLATFORM_URL:-} ]]
[[ -z ${BASH_ENV:-} ]]
[[ -z ${ENV:-} ]]
[[ -f "$XDG_CONFIG_HOME/tailor-platform/config.yaml" ]]
[[ -f "$XDG_CONFIG_HOME/auth-marker" ]]
[[ -f "$XDG_CONFIG_HOME/auth-argv" ]]

if [[ -n ${PARENT_ENV_MARKER:-} ]]; then
  if [[ -r /proc/$PPID/environ ]]; then
    tr '\0' '\n' </proc/"$PPID"/environ >"$PARENT_ENV_MARKER"
  else
    ps eww -p "$PPID" -o command= >"$PARENT_ENV_MARKER"
  fi
fi

if [[ -n ${TARGET_MARKER:-} ]]; then
  printf '%s' "$XDG_CONFIG_HOME" >"$TARGET_MARKER"
fi

if [[ -n ${AUTH_MARKER:-} ]]; then
  printf '%s' "$XDG_CONFIG_HOME" >"$AUTH_MARKER"
fi

if [[ -n ${AUTH_ARGV_MARKER:-} ]]; then
  /bin/cp "$XDG_CONFIG_HOME/auth-argv" "$AUTH_ARGV_MARKER"
fi

if [[ -n ${SPAWN_ORPHAN:-} ]]; then
  /bin/sleep 2 </dev/null >/dev/null 2>&1 &
  orphan_pid=$!
  if [[ -n ${ORPHAN_PID_MARKER:-} ]]; then
    printf '%s' "$orphan_pid" >"$ORPHAN_PID_MARKER"
  fi
fi

if [[ -n ${TARGET_PARENT_SIGNAL:-} ]]; then
  kill -s "$TARGET_PARENT_SIGNAL" "$PPID"
fi

if [[ -n ${TARGET_DELAY:-} ]]; then
  /bin/sleep "$TARGET_DELAY"
fi

if [[ -n ${TARGET_COMPLETION_MARKER:-} ]]; then
  printf 'completed' >"$TARGET_COMPLETION_MARKER"
fi

if [[ -n ${TARGET_SIGNAL:-} ]]; then
  kill -s "$TARGET_SIGNAL" "$$"
fi

exit "${FAIL_TARGET:-0}"
