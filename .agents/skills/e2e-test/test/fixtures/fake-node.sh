#!/bin/bash

set -euo pipefail

[[ -z ${NODE_OPTIONS:-} ]]
[[ -z ${NODE_PATH:-} ]]
[[ -z ${PATH:-} ]]
[[ -z ${TAILOR_PLATFORM_URL:-} ]]
[[ -z ${PLATFORM_URL:-} ]]
[[ ${HOME:-} == "$XDG_CONFIG_HOME/home" ]]

cli=$1
shift
exec /bin/bash "$cli" "$@"
