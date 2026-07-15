#!/bin/bash

set -euo pipefail

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

/bin/mkdir -p "$XDG_CONFIG_HOME/tailor-platform"
printf 'version: 3\ncurrent_user: test-client\n' >"$XDG_CONFIG_HOME/tailor-platform/config.yaml"
printf 'authenticated' >"$XDG_CONFIG_HOME/auth-marker"
/bin/ps -p "$$" -o command= >"$XDG_CONFIG_HOME/auth-argv"

if [[ $TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID == fail-auth ]]; then
  exit 22
fi
