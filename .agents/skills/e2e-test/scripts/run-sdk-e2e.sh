#!/bin/bash

set -uo pipefail

script_path=${BASH_SOURCE[0]}
[[ "$script_path" == /* ]] || script_path="$PWD/$script_path"
script_dir=${script_path%/*}
workspace_cleanup="$script_dir/cleanup-e2e-workspaces.mjs"

if [[ -n ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:-} || -n ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:-} ]]; then
  echo "Machine-user client credentials must not be present in the e2e process." >&2
  exit 64
fi

repo_root=$(git -C "$script_dir" rev-parse --show-toplevel) || exit 1
cd "$repo_root/packages/sdk" || exit 1

for required_id in TAILOR_PLATFORM_ORGANIZATION_ID TAILOR_PLATFORM_FOLDER_ID; do
  id_value=${!required_id:-}
  if [[ ! "$id_value" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$ ]]; then
    echo "$required_id must contain a UUID." >&2
    exit 64
  fi
done

run_id=${TAILOR_PLATFORM_E2E_RUN_ID:-"local-$(date +%s)-$$-$RANDOM"}
if [[ ${#run_id} -lt 8 || ${#run_id} -gt 40 || ! "$run_id" =~ ^[a-z0-9-]+$ ]]; then
  echo "TAILOR_PLATFORM_E2E_RUN_ID must be 8-40 lowercase letters, digits, or hyphens." >&2
  exit 64
fi
export TAILOR_PLATFORM_E2E_RUN_ID="$run_id"

cleanup_node=$(type -P node)
if [[ "$cleanup_node" != /* || ! -x "$cleanup_node" || ! -r "$workspace_cleanup" ]]; then
  echo "An absolute executable Node.js path and the cleanup helper are required." >&2
  exit 64
fi

test_pid=""
interrupted_status=0
forward_signal() {
  local signal_name=$1 signal_status=$2
  [[ $interrupted_status -ne 0 ]] || interrupted_status=$signal_status
  if [[ "$test_pid" =~ ^[0-9]+$ ]]; then
    kill -s "$signal_name" -- "-$test_pid" 2>/dev/null || true
  fi
}
trap 'forward_signal HUP 129' HUP
trap 'forward_signal INT 130' INT
trap 'forward_signal TERM 143' TERM

set -m
pnpm run test:e2e &
test_pid=$!
set +m
wait "$test_pid"
test_status=$?
if [[ $interrupted_status -ne 0 ]]; then
  wait "$test_pid" 2>/dev/null || true
  test_status=$interrupted_status
fi
test_pid=""
trap - HUP INT TERM

"$cleanup_node" "$workspace_cleanup" "$run_id" -- pnpm exec tailor
cleanup_status=$?

echo "E2E test status: $test_status; cleanup status: $cleanup_status" >&2

if [[ $cleanup_status -ne 0 ]]; then
  exit "$cleanup_status"
fi
exit "$test_status"
