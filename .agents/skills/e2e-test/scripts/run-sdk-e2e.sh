#!/bin/bash

set -uo pipefail

script_path=${BASH_SOURCE[0]}
[[ "$script_path" == /* ]] || script_path="$PWD/$script_path"
script_dir=${script_path%/*}

if [[ -n ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:-} || -n ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:-} ]]; then
  echo "Machine-user client credentials must not be present in the e2e process." >&2
  exit 64
fi

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root/packages/sdk" || exit 1

run_id=${TAILOR_PLATFORM_E2E_RUN_ID:-"local-$(date +%s)-$$-$RANDOM"}
if [[ ${#run_id} -lt 8 || ! "$run_id" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "TAILOR_PLATFORM_E2E_RUN_ID must be at least 8 safe filename characters." >&2
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
  local workspace_output workspace_status verification_node

  if [[ -n ${TAILOR_E2E_TRUSTED_NODE:-} || -n ${TAILOR_E2E_TRUSTED_CLI:-} ]]; then
    if [[ ${TAILOR_E2E_TRUSTED_NODE:-} != /* || ! -x ${TAILOR_E2E_TRUSTED_NODE:-} ||
      ${TAILOR_E2E_TRUSTED_CLI:-} != /* || ! -r ${TAILOR_E2E_TRUSTED_CLI:-} ]]; then
      echo "Trusted raw-verification Node.js and CLI paths must both be valid." >&2
      return 64
    fi
    workspace_output=$("$TAILOR_E2E_TRUSTED_NODE" "$TAILOR_E2E_TRUSTED_CLI" --json workspace list)
    workspace_status=$?
    verification_node=$TAILOR_E2E_TRUSTED_NODE
  else
    workspace_output=$(pnpm exec tailor-sdk --json workspace list)
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
    "$verification_node" "$script_dir/verify-workspace-list.mjs" "$run_id"
}

run_cleanup() {
  local preview_status cleanup_status verification_status verification_output attempt
  local line success_lines found_workspaces

  pnpm exec tsx scripts/cleanup-e2e-workspaces.ts --dry-run "--run-id=$run_id"
  preview_status=$?
  if [[ $preview_status -ne 0 ]]; then
    return "$preview_status"
  fi

  pnpm exec tsx scripts/cleanup-e2e-workspaces.ts "--run-id=$run_id"
  cleanup_status=$?
  if [[ $cleanup_status -ne 0 ]]; then
    return "$cleanup_status"
  fi

  verification_status=1
  verification_output=""
  for attempt in 1 2 3; do
    verification_output=$(pnpm exec tsx scripts/cleanup-e2e-workspaces.ts --dry-run "--run-id=$run_id" 2>&1)
    verification_status=$?
    success_lines=0
    found_workspaces=0
    while IFS= read -r line; do
      [[ "$line" == "✅ No e2e workspaces found to delete." ]] && ((success_lines += 1))
      [[ "$line" == Found\ *\ e2e\ workspace\(s\): ]] && found_workspaces=1
    done <<<"$verification_output"
    if [[ $verification_status -eq 0 && $success_lines -eq 1 && $found_workspaces -eq 0 ]]; then
      printf '%s\n' "$verification_output"
      verify_raw_workspace_list
      verification_status=$?
      [[ $verification_status -ne 0 ]] || return 0
    fi
    [[ $attempt -eq 3 ]] || sleep 1
  done

  printf '%s\n' "$verification_output" >&2
  if [[ $verification_status -ne 0 ]]; then
    return "$verification_status"
  fi
  echo "Cleanup verification still found workspaces for run ID $run_id." >&2
  return 1
}

handle_signal() {
  local signal_status=$1
  trap - INT TERM
  run_cleanup
  local cleanup_status=$?
  echo "E2E interrupted (status $signal_status); cleanup status: $cleanup_status" >&2
  exit "$signal_status"
}
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

pnpm run test -- --project e2e
test_status=$?

run_cleanup
cleanup_status=$?
trap - INT TERM

echo "E2E test status: $test_status; cleanup status: $cleanup_status" >&2

if [[ $cleanup_status -ne 0 ]]; then
  exit "$cleanup_status"
fi
exit "$test_status"
