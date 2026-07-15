#!/bin/bash

set -uo pipefail

script_path=${BASH_SOURCE[0]}
[[ "$script_path" == /* ]] || script_path="$PWD/$script_path"
script_dir=${script_path%/*}
cleanup_supervisor="$script_dir/supervise-process-group.sh"

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
workspace_name_prefix="e2e-ws-${run_id}-"
isolated_auth_run=0

run_tmp=$(mktemp -d "${TMPDIR:-/tmp}/tailor-sdk-e2e.XXXXXX") || exit 1
chmod 700 "$run_tmp"
export TMPDIR="$run_tmp"
cleanup_local_tmp() {
  rm -rf -- "$run_tmp"
}
trap cleanup_local_tmp EXIT

run_cleanup_command() {
  local command_pid command_status signal_count_before

  if [[ $isolated_auth_run -eq 1 ]]; then
    if [[ ! -r "$cleanup_supervisor" ]]; then
      echo "Cleanup process-group supervisor is missing." >&2
      return 1
    fi
    set -m
    /bin/bash "$cleanup_supervisor" "$$" "$run_tmp" - -- "$@" &
    command_pid=$!
    set +m
  else
    set -m
    "$@" &
    command_pid=$!
    set +m
  fi

  while true; do
    signal_count_before=$cleanup_signal_count
    wait "$command_pid"
    command_status=$?
    if [[ $cleanup_signal_count -ne $signal_count_before ]]; then
      continue
    fi
    return "$command_status"
  done
}

signal_process_tree() {
  local root_pid=$1 signal_name=$2 child_pid index
  local -a process_ids=("$root_pid")

  index=0
  while [[ $index -lt ${#process_ids[@]} ]]; do
    for child_pid in $(/usr/bin/pgrep -P "${process_ids[$index]}" 2>/dev/null); do
      process_ids+=("$child_pid")
    done
    ((index += 1))
  done

  for ((index = ${#process_ids[@]} - 1; index >= 0; index--)); do
    kill -s "$signal_name" "${process_ids[$index]}" 2>/dev/null || true
  done
}

verify_raw_workspace_list() {
  local phase=$1 workspace_output workspace_output_file workspace_status verification_node

  workspace_output_file="$run_tmp/workspace-list-$phase.json"

  if [[ -n ${TAILOR_E2E_TRUSTED_NODE:-} || -n ${TAILOR_E2E_TRUSTED_CLI:-} ]]; then
    if [[ ${TAILOR_E2E_TRUSTED_NODE:-} != /* || ! -x ${TAILOR_E2E_TRUSTED_NODE:-} ||
      ${TAILOR_E2E_TRUSTED_CLI:-} != /* || ! -r ${TAILOR_E2E_TRUSTED_CLI:-} ]]; then
      echo "Trusted raw-verification Node.js and CLI paths must both be valid." >&2
      return 64
    fi
    run_cleanup_command \
      /usr/bin/env -u TAILOR_PLATFORM_PROFILE \
      "$TAILOR_E2E_TRUSTED_NODE" "$TAILOR_E2E_TRUSTED_CLI" --json workspace list \
      >"$workspace_output_file"
    workspace_status=$?
    verification_node=$TAILOR_E2E_TRUSTED_NODE
  else
    run_cleanup_command \
      /usr/bin/env -u TAILOR_PLATFORM_PROFILE pnpm exec tailor-sdk --json workspace list \
      >"$workspace_output_file"
    workspace_status=$?
    verification_node=$(type -P node)
  fi

  if [[ $workspace_status -ne 0 ]]; then
    return "$workspace_status"
  fi
  workspace_output=$(<"$workspace_output_file")
  /bin/rm -f -- "$workspace_output_file"
  if [[ "$verification_node" != /* || ! -x "$verification_node" ]]; then
    echo "An absolute executable Node.js path is required for raw cleanup verification." >&2
    return 64
  fi

  run_cleanup_command \
    "$verification_node" "$script_dir/verify-workspace-list.mjs" "$run_id" "$phase" \
    <<<"$workspace_output"
}

run_cleanup() {
  local preview_status pre_audit_status cleanup_status verification_status attempt

  run_cleanup_command pnpm exec tsx scripts/cleanup-e2e-workspaces.ts \
    --dry-run \
    "--run-id=$run_id" \
    "--workspace-name-prefix=$workspace_name_prefix"
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

  run_cleanup_command pnpm exec tsx scripts/cleanup-e2e-workspaces.ts \
    "--run-id=$run_id" \
    "--workspace-name-prefix=$workspace_name_prefix"
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
  if [[ $cleanup_in_progress -eq 1 ]]; then
    [[ $interrupted_status -ne 0 ]] || interrupted_status=$signal_status
    ((cleanup_signal_count += 1))
    echo "E2E interrupted during cleanup (status $signal_status); cleanup will continue." >&2
    return
  fi

  interrupted_status=$signal_status
  if [[ -n ${test_pid:-} ]]; then
    if [[ $isolated_auth_run -eq 1 ]]; then
      signal_process_tree "$test_pid" "$signal_name"
    else
      kill -s "$signal_name" -- "-$test_pid" 2>/dev/null || true
    fi
    wait "$test_pid" 2>/dev/null || true
    test_pid=""
  fi
  cleanup_in_progress=1
  run_cleanup
  cleanup_status=$?
  echo "E2E interrupted (status $signal_status); cleanup status: $cleanup_status" >&2
  exit "$signal_status"
}
cleanup_in_progress=0
cleanup_signal_count=0
interrupted_status=0
trap 'handle_signal HUP 129' HUP
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM

test_pid=""
if [[ -n ${TAILOR_E2E_TRUSTED_NODE:-} ]]; then
  isolated_auth_run=1
  pnpm run test -- --project e2e &
  test_pid=$!
else
  set -m
  pnpm run test -- --project e2e &
  test_pid=$!
  set +m
fi
wait "$test_pid"
test_status=$?
test_pid=""

cleanup_in_progress=1
run_cleanup
cleanup_status=$?
cleanup_in_progress=0
trap - HUP INT TERM

echo "E2E test status: $test_status; cleanup status: $cleanup_status" >&2

if [[ $interrupted_status -ne 0 ]]; then
  exit "$interrupted_status"
fi
if [[ $cleanup_status -ne 0 ]]; then
  exit "$cleanup_status"
fi
exit "$test_status"
