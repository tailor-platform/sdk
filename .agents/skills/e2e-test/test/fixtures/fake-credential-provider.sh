#!/bin/bash

set +x
set -euo pipefail

[[ -z ${BASH_ENV:-} ]]
[[ -z ${NODE_OPTIONS:-} ]]

client_id=test-client
[[ ${1:-} != fail-auth ]] || client_id=fail-auth
[[ ${1:-} != slow-auth ]] || client_id=slow-auth
printf '%s\0%s\0' "$client_id" 'test-secret-that-must-not-leak'
[[ ${1:-} != extra ]] || printf 'unexpected-third-field'
