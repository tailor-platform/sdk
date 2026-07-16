#!/bin/bash

set -euo pipefail

cli=$1
shift

if [[ "$cli" == *.mjs ]]; then
  [[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:-} ]]
  [[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:-} ]]
  real_node=$(type -P node)
  [[ "$real_node" == /* && -x "$real_node" ]]
  exec "$real_node" "$cli" "$@"
fi

if [[ ${1:-} == "--json" ]]; then
  [[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:-} ]]
  [[ -z ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:-} ]]
  exec /bin/bash "$cli" "$@"
fi

[[ -z ${NODE_OPTIONS:-} ]]
[[ -z ${NODE_PATH:-} ]]
[[ -z ${PATH:-} ]]
[[ -z ${TAILOR_PLATFORM_URL:-} ]]
[[ -z ${PLATFORM_URL:-} ]]
[[ ${HOME:-} == "$XDG_CONFIG_HOME/home" ]]

exec /bin/bash "$cli" "$@"
