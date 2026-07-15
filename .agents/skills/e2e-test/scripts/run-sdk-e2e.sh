#!/bin/bash

set -uo pipefail

script_path=${BASH_SOURCE[0]}
[[ "$script_path" == /* ]] || script_path="$PWD/$script_path"
script_dir=${script_path%/*}

if [[ -n ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:-} || -n ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:-} ]]; then
  echo "Machine-user client credentials must not be present in the e2e process." >&2
  exit 64
fi

repo_root=$(git -C "$script_dir" rev-parse --show-toplevel)
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

run_tmp=$(mktemp -d "${TMPDIR:-/tmp}/tailor-sdk-e2e.XXXXXX") || exit 1
chmod 700 "$run_tmp"
export TMPDIR="$run_tmp"
cleanup_local_tmp() {
  rm -rf -- "$run_tmp"
}
trap cleanup_local_tmp EXIT

verify_raw_workspace_list() {
  local phase=$1 workspace_output workspace_status verification_node

  if [[ -n ${TAILOR_E2E_TRUSTED_NODE:-} || -n ${TAILOR_E2E_TRUSTED_CLI:-} ]]; then
    if [[ ${TAILOR_E2E_TRUSTED_NODE:-} != /* || ! -x ${TAILOR_E2E_TRUSTED_NODE:-} ||
      ${TAILOR_E2E_TRUSTED_CLI:-} != /* || ! -r ${TAILOR_E2E_TRUSTED_CLI:-} ]]; then
      echo "Trusted raw-verification Node.js and CLI paths must both be valid." >&2
      return 64
    fi
    workspace_output=$(
      /usr/bin/env -u TAILOR_PLATFORM_PROFILE \
        "$TAILOR_E2E_TRUSTED_NODE" "$TAILOR_E2E_TRUSTED_CLI" --json workspace list
    )
    workspace_status=$?
    verification_node=$TAILOR_E2E_TRUSTED_NODE
  else
    workspace_output=$(/usr/bin/env -u TAILOR_PLATFORM_PROFILE pnpm exec tailor-sdk --json workspace list)
    workspace_status=$?
    verification_node=$(type -P node)
  fi

  if [[ $workspace_status -ne 0 ]]; then
    return "$workspace_status"
  fi
  if [[ "$verification_node" != /* || ! -x "$verification_node" ]]; then
    echo "An absolute executable Node.js path is required for raw cleanup verification." >&2
    return 64
  fi

  printf '%s' "$workspace_output" |
    "$verification_node" "$script_dir/verify-workspace-list.mjs" "$run_id" "$phase"
}

run_cleanup() {
  local preview_status pre_audit_status cleanup_status verification_status attempt

  pnpm exec tsx scripts/cleanup-e2e-workspaces.ts --dry-run "--run-id=$run_id"
  preview_status=$?
  if [[ $preview_status -ne 0 ]]; then
    return "$preview_status"
  fi

  verify_raw_workspace_list before-delete
  pre_audit_status=$?
  if [[ $pre_audit_status -ne 0 ]]; then
    echo "Cleanup stopped because the raw workspace pre-audit was not safe." >&2
    return "$pre_audit_status"
  fi

  pnpm exec tsx scripts/cleanup-e2e-workspaces.ts "--run-id=$run_id"
  cleanup_status=$?
  if [[ $cleanup_status -ne 0 ]]; then
    return "$cleanup_status"
  fi

  verification_status=1
  for attempt in 1 2 3; do
    verify_raw_workspace_list after-delete
    verification_status=$?
    [[ $verification_status -ne 0 ]] || return 0
    [[ $attempt -eq 3 ]] || sleep 1
  done

  echo "Cleanup verification still found workspaces for run ID $run_id." >&2
  return "$verification_status"
}

handle_signal() {
  local signal_name=$1 signal_status=$2 cleanup_status
  trap - HUP INT TERM
  if [[ -n ${test_pid:-} ]]; then
    kill -s "$signal_name" -- "-$test_pid" 2>/dev/null || true
    wait "$test_pid" 2>/dev/null || true
    test_pid=""
  fi
  run_cleanup
  cleanup_status=$?
  echo "E2E interrupted (status $signal_status); cleanup status: $cleanup_status" >&2
  exit "$signal_status"
}
trap 'handle_signal HUP 129' HUP
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM

test_pid=""
set -m
pnpm run test -- --project e2e &
test_pid=$!
set +m
wait "$test_pid"
test_status=$?
test_pid=""
trap - HUP INT TERM

run_cleanup
cleanup_status=$?

echo "E2E test status: $test_status; cleanup status: $cleanup_status" >&2

if [[ $cleanup_status -ne 0 ]]; then
  exit "$cleanup_status"
fi
exit "$test_status"
