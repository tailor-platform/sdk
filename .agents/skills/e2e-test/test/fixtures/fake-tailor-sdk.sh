#!/bin/bash

set -euo pipefail

if [[ ${1:-} == "--json" && ${2:-} == "workspace" && ${3:-} == "list" ]]; then
  [[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:-} ]]
  [[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:-} ]]
  [[ -z ${TAILOR_PLATFORM_PROFILE:-} ]]
  if [[ -n ${TAILOR_E2E_CLEANUP_PHASE:-} ]]; then
    if [[ -n ${E2E_CLEANUP_CLI_MARKER:-} ]]; then
      printf '%s\n' "$TAILOR_E2E_CLEANUP_PHASE" >>"$E2E_CLEANUP_CLI_MARKER"
    fi
    if [[ ${E2E_CLEANUP_DELAY_AT:-} == "$TAILOR_E2E_CLEANUP_PHASE" ]]; then
      [[ -z ${E2E_CLEANUP_STARTED_MARKER:-} ]] || printf 'started' >"$E2E_CLEANUP_STARTED_MARKER"
      [[ -z ${E2E_CLEANUP_PID_MARKER:-} ]] || printf '%s' "$$" >"$E2E_CLEANUP_PID_MARKER"
      /bin/sleep "${E2E_CLEANUP_DELAY:-1}"
      [[ -z ${E2E_CLEANUP_COMPLETION_MARKER:-} ]] ||
        printf 'completed' >"$E2E_CLEANUP_COMPLETION_MARKER"
    fi
  elif [[ -n ${E2E_RAW_AUDIT_MARKER:-} ]]; then
    printf 'audit\n' >>"$E2E_RAW_AUDIT_MARKER"
  fi
  if [[ -n ${E2E_TRUSTED_EXACT_CANDIDATE:-} && ! -s ${E2E_TRUSTED_DELETE_MARKER:-/dev/null} ]]; then
    printf '[{"id":"00000000-0000-4000-8000-000000000020","name":"e2e-ws-%s-trusted"}]\n' \
      "$TAILOR_PLATFORM_E2E_RUN_ID"
  else
    printf '[]\n'
  fi
  exit 0
fi

if [[ ${1:-} == "workspace" && ${2:-} == "delete" ]]; then
  [[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:-} ]]
  [[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:-} ]]
  [[ -z ${TAILOR_PLATFORM_PROFILE:-} ]]
  [[ ${3:-} == "--workspace-id" && -n ${4:-} && ${5:-} == "--yes" ]]
  [[ -z ${E2E_TRUSTED_DELETE_MARKER:-} ]] || printf '%s\n' "$4" >>"$E2E_TRUSTED_DELETE_MARKER"
  exit "${E2E_DELETE_STATUS:-0}"
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
