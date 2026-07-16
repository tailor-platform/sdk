#!/bin/bash

set -euo pipefail

if [[ ${1:-} == "--json" && ${2:-} == "workspace" && ${3:-} == "list" ]]; then
  [[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:-} ]]
  [[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:-} ]]
  [[ -z ${TAILOR_PLATFORM_PROFILE:-} ]]
  if [[ -n ${E2E_RAW_AUDIT_MARKER:-} ]]; then
    printf 'audit\n' >>"$E2E_RAW_AUDIT_MARKER"
  fi
  printf '[]\n'
  exit 0
fi

[[ ${1:-} == "login" ]]
[[ ${2:-} == "--machine-user" ]]
[[ -n ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:-} ]]
[[ -n ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:-} ]]
[[ -z ${TAILOR_PLATFORM_TOKEN:-} ]]
[[ -z ${TAILOR_PLATFORM_PROFILE:-} ]]
[[ -n ${XDG_CONFIG_HOME:-} ]]

if [[ $TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID == slow-auth ]]; then
  printf 'started' >"$XDG_CONFIG_HOME/auth-started"
  /bin/sleep 0.3
  printf 'completed' >"$XDG_CONFIG_HOME/auth-completed"
fi

if [[ $TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID == kill-parent-auth ]]; then
  printf 'started' >"$XDG_CONFIG_HOME/auth-race-started"
  (
    /bin/sleep 1
    printf 'completed' >"$XDG_CONFIG_HOME/auth-race-completed"
  ) &
  printf '%s' "$!" >"$XDG_CONFIG_HOME/auth-race-child-pid"
  helper_pid=$(/bin/ps -o ppid= -p "$PPID" | /usr/bin/tr -d ' ')
  /bin/kill -KILL "$helper_pid"
  /bin/sleep 1
fi

/bin/mkdir -p "$XDG_CONFIG_HOME/tailor-platform"
printf 'version: 3\ncurrent_user: test-client\n' >"$XDG_CONFIG_HOME/tailor-platform/config.yaml"
printf 'authenticated' >"$XDG_CONFIG_HOME/auth-marker"
/bin/ps -p "$$" -o command= >"$XDG_CONFIG_HOME/auth-argv"

if [[ $TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID == fail-auth ]]; then
  exit 22
fi
