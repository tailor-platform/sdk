#!/bin/bash

set +x
set -euo pipefail

[[ -z ${BASH_ENV:-} ]]
[[ -z ${NODE_OPTIONS:-} ]]

client_id=test-client
[[ ${1:-} != fail-auth ]] || client_id=fail-auth
printf '%s\0%s\0' "$client_id" 'test-secret-that-must-not-leak'
