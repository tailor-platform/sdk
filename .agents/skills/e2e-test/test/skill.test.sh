#!/usr/bin/env bash

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
skill_dir="$repo_root/.agents/skills/e2e-test"
cleanup_helper="$skill_dir/scripts/cleanup-e2e-workspaces.mjs"
ids_helper="$skill_dir/scripts/with-e2e-ids.sh"
runner="$skill_dir/scripts/run-sdk-e2e.sh"
fixtures="$skill_dir/test/fixtures"
fake_cli="$fixtures/fake-tailor-sdk.mjs"
fake_pnpm_source="$fixtures/bin/pnpm"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ $(wc -l <"$skill_dir/SKILL.md") -le 100 ]] || fail "SKILL.md exceeds 100 lines"
grep -q '^name: e2e-test$' "$skill_dir/SKILL.md" || fail "skill name is incorrect"

for required_file in "$cleanup_helper" "$ids_helper" "$runner" "$fake_cli" "$fake_pnpm_source"; do
  [[ -f "$required_file" ]] || fail "required file is missing: $required_file"
done
for obsolete_file in \
  "$skill_dir/scripts/supervise-process-group.sh" \
  "$skill_dir/scripts/verify-workspace-list.mjs" \
  "$skill_dir/scripts/with-machine-user-auth.sh"; do
  [[ ! -e "$obsolete_file" ]] || fail "obsolete unattended helper remains: $obsolete_file"
done
if grep -q 'scripts/cleanup-e2e-workspaces.ts' "$runner"; then
  fail "runner uses the shared unscoped cleanup script"
fi

bash -n "$ids_helper"
bash -n "$runner"
bash -n "$fixtures/bin/pnpm"
node_path=$(mise which node)
"$node_path" --check "$cleanup_helper"
"$node_path" --check "$fake_cli"

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/e2e-test-skill.XXXXXX")
trap 'rm -rf -- "$tmp_dir"' EXIT
fake_bin="$tmp_dir/bin"
mkdir "$fake_bin"
cp "$fake_pnpm_source" "$fake_bin/pnpm"
chmod +x "$fake_bin/pnpm"
resolved_pnpm=$(PATH="$fake_bin:$PATH" command -v pnpm)
[[ "$resolved_pnpm" == "$fake_bin/pnpm" ]] || fail "fake pnpm does not shadow the real CLI"
run_id=test-run-12345
candidate_id=00000000-0000-4000-8000-000000000010
second_id=00000000-0000-4000-8000-000000000011
outside_id=00000000-0000-4000-8000-000000000012
state_file="$tmp_dir/workspaces.json"
delete_log="$tmp_dir/deleted.log"

run_cleanup() {
  E2E_FAKE_STATE="$state_file" \
    E2E_DELETE_LOG="$delete_log" \
    "$node_path" "$cleanup_helper" "$run_id" -- "$node_path" "$fake_cli"
}

printf '%s\n' \
  "[{\"id\":\"$candidate_id\",\"name\":\"e2e-ws-$run_id-first\"},{\"id\":\"$outside_id\",\"name\":\"e2e-ws-other-run-workspace\"}]" \
  >"$state_file"
: >"$delete_log"
run_cleanup
[[ $(<"$delete_log") == "$candidate_id" ]] || fail "cleanup selected the wrong workspace"
grep -q "$outside_id" "$state_file" || fail "cleanup deleted an out-of-scope workspace"
if grep -q "$candidate_id" "$state_file"; then
  fail "cleanup left the exact workspace"
fi

for invalid_state in 'not-json' '[{"name":7}]' "[{\"name\":\"e2e-ws-$run_id-missing-id\"}]"; do
  printf '%s\n' "$invalid_state" >"$state_file"
  : >"$delete_log"
  set +e
  run_cleanup >/dev/null 2>&1
  invalid_status=$?
  set -e
  [[ $invalid_status -ne 0 ]] || fail "cleanup accepted invalid workspace evidence"
  [[ ! -s "$delete_log" ]] || fail "cleanup deleted from invalid workspace evidence"
done

rm -f "$state_file"
set +e
run_cleanup >/dev/null 2>&1
missing_status=$?
set -e
[[ $missing_status -ne 0 ]] || fail "cleanup accepted missing workspace evidence"

printf '%s\n' \
  "[{\"id\":\"$candidate_id\",\"name\":\"e2e-ws-$run_id-stale\"}]" >"$state_file"
: >"$delete_log"
set +e
E2E_FAKE_STATE="$state_file" \
  E2E_DELETE_LOG="$delete_log" \
  E2E_KEEP_DELETED=1 \
  "$node_path" "$cleanup_helper" "$run_id" -- "$node_path" "$fake_cli" >/dev/null 2>&1
stale_status=$?
set -e
[[ $stale_status -ne 0 ]] || fail "post-audit accepted a residual workspace"

printf '%s\n' \
  "[{\"id\":\"$candidate_id\",\"name\":\"e2e-ws-$run_id-first\"},{\"id\":\"$second_id\",\"name\":\"e2e-ws-$run_id-second\"}]" \
  >"$state_file"
: >"$delete_log"
set +e
E2E_FAKE_STATE="$state_file" \
  E2E_DELETE_LOG="$delete_log" \
  E2E_FAIL_DELETE_ID="$candidate_id" \
  "$node_path" "$cleanup_helper" "$run_id" -- "$node_path" "$fake_cli" >/dev/null 2>&1
partial_status=$?
set -e
[[ $partial_status -eq 25 ]] || fail "cleanup lost a deletion failure status"
[[ $(wc -l <"$delete_log") -eq 2 ]] || fail "cleanup stopped after the first deletion failure"
grep -q "$candidate_id" "$state_file" || fail "post-audit fixture lost the failed workspace"
if grep -q "$second_id" "$state_file"; then
  fail "cleanup skipped a workspace after a deletion failure"
fi

ids_file="$tmp_dir/ids.local.env"
ids_marker="$tmp_dir/ids.marker"
printf '%s\n' \
  'TAILOR_PLATFORM_WORKSPACE_ID=00000000-0000-4000-8000-000000000000' \
  'TAILOR_PLATFORM_ORGANIZATION_ID=00000000-0000-4000-8000-000000000001' \
  'TAILOR_PLATFORM_FOLDER_ID=00000000-0000-4000-8000-000000000002' \
  >"$ids_file"
/bin/bash "$ids_helper" "$ids_file" -- /bin/bash -c \
  'printf "%s\n%s\n%s\n" "$TAILOR_PLATFORM_WORKSPACE_ID" "$TAILOR_PLATFORM_ORGANIZATION_ID" "$TAILOR_PLATFORM_FOLDER_ID" >"$1"' \
  bash "$ids_marker"
[[ $(wc -l <"$ids_marker") -eq 3 ]] || fail "ID loader did not pass the supported IDs"

malicious_marker="$tmp_dir/malicious.marker"
printf '%s\n' 'UNSUPPORTED=$(touch malicious.marker)' >"$ids_file"
set +e
/bin/bash "$ids_helper" "$ids_file" -- /usr/bin/touch "$malicious_marker" >/dev/null 2>&1
malicious_status=$?
set -e
[[ $malicious_status -ne 0 && ! -e "$malicious_marker" ]] ||
  fail "ID loader accepted executable or unsupported content"

test_marker="$tmp_dir/test.marker"
organization_id=00000000-0000-4000-8000-000000000001
folder_id=00000000-0000-4000-8000-000000000002

run_runner() {
  PATH="$fake_bin:$PATH" \
    E2E_FAKE_NODE="$node_path" \
    E2E_FAKE_CLI="$fake_cli" \
    E2E_FAKE_STATE="$state_file" \
    E2E_DELETE_LOG="$delete_log" \
    E2E_TEST_MARKER="$test_marker" \
    TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
    TAILOR_PLATFORM_ORGANIZATION_ID="$organization_id" \
    TAILOR_PLATFORM_FOLDER_ID="$folder_id" \
    /bin/bash "$runner"
}

printf '%s\n' \
  "[{\"id\":\"$candidate_id\",\"name\":\"e2e-ws-$run_id-runner\"}]" >"$state_file"
: >"$delete_log"
run_runner
[[ $(<"$test_marker") == "$run_id" ]] || fail "runner did not pass its run ID to the suite"
[[ $(<"$delete_log") == "$candidate_id" ]] || fail "runner did not clean its exact workspace"

printf '%s\n' \
  "[{\"id\":\"$candidate_id\",\"name\":\"e2e-ws-$run_id-test-failure\"}]" >"$state_file"
: >"$delete_log"
set +e
E2E_TEST_STATUS=23 run_runner >/dev/null 2>&1
test_failure_status=$?
set -e
[[ $test_failure_status -eq 23 ]] || fail "runner lost the test failure status"
[[ $(<"$delete_log") == "$candidate_id" ]] || fail "runner skipped cleanup after test failure"

printf '%s\n' \
  "[{\"id\":\"$candidate_id\",\"name\":\"e2e-ws-$run_id-cleanup-failure\"}]" >"$state_file"
: >"$delete_log"
set +e
E2E_FAIL_DELETE_ID="$candidate_id" run_runner >/dev/null 2>&1
cleanup_failure_status=$?
set -e
[[ $cleanup_failure_status -eq 25 ]] || fail "runner lost the cleanup failure status"

printf '%s\n' \
  "[{\"id\":\"$candidate_id\",\"name\":\"e2e-ws-$run_id-signal\"}]" >"$state_file"
: >"$delete_log"
rm -f "$test_marker"
signal_child_marker="$tmp_dir/signal-child.pid"
signal_completion_marker="$tmp_dir/signal-completed.marker"
PATH="$fake_bin:$PATH" \
  E2E_FAKE_NODE="$node_path" \
  E2E_FAKE_CLI="$fake_cli" \
  E2E_FAKE_STATE="$state_file" \
  E2E_DELETE_LOG="$delete_log" \
  E2E_TEST_MARKER="$test_marker" \
  E2E_TEST_DELAY=10 \
  E2E_TEST_CHILD_PID_MARKER="$signal_child_marker" \
  E2E_TEST_COMPLETION_MARKER="$signal_completion_marker" \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  TAILOR_PLATFORM_ORGANIZATION_ID="$organization_id" \
  TAILOR_PLATFORM_FOLDER_ID="$folder_id" \
  /bin/bash "$runner" >/dev/null 2>&1 &
runner_pid=$!
for _ in {1..100}; do
  [[ -s "$test_marker" && -s "$signal_child_marker" ]] && break
  /bin/sleep 0.02
done
[[ -s "$test_marker" && -s "$signal_child_marker" ]] || fail "signal fixture did not start"
signal_child_pid=$(<"$signal_child_marker")
kill -TERM "$runner_pid"
set +e
wait "$runner_pid"
signal_status=$?
set -e
[[ $signal_status -eq 143 ]] || fail "runner lost the signal status"
[[ $(<"$delete_log") == "$candidate_id" ]] || fail "runner skipped cleanup after a signal"
if kill -0 "$signal_child_pid" 2>/dev/null; then
  kill -KILL "$signal_child_pid" 2>/dev/null || true
  fail "test descendant survived the forwarded signal"
fi
[[ ! -e "$signal_completion_marker" ]] || fail "test descendant completed after the signal"

echo "e2e-test skill checks passed"
