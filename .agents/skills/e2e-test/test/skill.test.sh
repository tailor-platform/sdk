#!/usr/bin/env bash

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
skill_dir="$repo_root/.agents/skills/e2e-test"
helper_source="$skill_dir/scripts/with-machine-user-auth.sh"
supervisor_source="$skill_dir/scripts/supervise-process-group.sh"
ids_helper_source="$skill_dir/scripts/with-e2e-ids.sh"
runner_source="$skill_dir/scripts/run-sdk-e2e.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

wait_for_path_removal() {
  local path=$1 message=$2
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [[ ! -e "$path" ]] && return 0
    sleep 0.05
  done
  fail "$message"
}

wait_for_path() {
  local path=$1 message=$2
  for _ in {1..40}; do
    [[ -e "$path" ]] && return 0
    sleep 0.05
  done
  fail "$message"
}

wait_for_empty_directory() {
  local path=$1 message=$2
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [[ -z $(find "$path" -mindepth 1 -maxdepth 1 -print -quit) ]] && return 0
    sleep 0.05
  done
  fail "$message"
}

wait_for_process_exit() {
  local pid=$1 message=$2
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    ! kill -0 "$pid" 2>/dev/null && return 0
    sleep 0.05
  done
  kill -KILL "$pid" 2>/dev/null || true
  fail "$message"
}

[[ ! -f "$repo_root/.agents/skills/e2e-setup/SKILL.md" ]] || fail "legacy SKILL.md remains"
[[ ! -f "$repo_root/.agents/skills/e2e-setup/.gitignore" ]] || fail "legacy skill ignore remains"
[[ -f "$skill_dir/SKILL.md" ]] || fail "SKILL.md is missing"
[[ -f "$skill_dir/AUTH.md" ]] || fail "AUTH.md is missing"
[[ -f "$skill_dir/SUITES.md" ]] || fail "SUITES.md is missing"
grep -q 'workspace user list' "$skill_dir/SUITES.md" ||
  fail "example deploy preflight does not inspect workspace users"
grep -q 'deploy --dry-run' "$skill_dir/SUITES.md" ||
  fail "example deploy preflight does not preview destructive changes"
grep -q 'explicit approval' "$skill_dir/SUITES.md" ||
  fail "example deploy preflight does not require approval for destructive changes"
[[ -f "$supervisor_source" ]] || fail "process-group supervisor is missing"
[[ -f "$helper_source" ]] || fail "authentication helper is missing"
[[ -f "$ids_helper_source" ]] || fail "ID loader is missing"
[[ $(wc -l <"$skill_dir/SKILL.md") -le 100 ]] || fail "SKILL.md exceeds 100 lines"
grep -q '^name: e2e-test$' "$skill_dir/SKILL.md" || fail "skill name was not updated"
if grep -q '\.managed-pgid' "$helper_source"; then
  fail "authentication helper still uses a racy PID-file handoff"
fi
grep -q 'process_supervisor' "$runner_source" ||
  fail "isolated cleanup does not use a direct-owner supervisor"
grep -q '!.claude/skills/e2e-test' "$repo_root/.gitignore" || fail "new Claude skill is not unignored"
if grep -q '!.claude/skills/e2e-setup' "$repo_root/.gitignore"; then
  fail "legacy skill ignore exception remains"
fi
[[ -L "$repo_root/.claude/skills/e2e-test" ]] || fail "Claude compatibility symlink is missing"
[[ $(readlink "$repo_root/.claude/skills/e2e-test") == "../../.agents/skills/e2e-test" ]] ||
  fail "Claude compatibility symlink points to the wrong target"
git check-ignore -q .agents/skills/e2e-setup/ids.local.env ||
  fail "legacy local ID file is not ignored during migration"

executable_files=$(git ls-files | while read -r file; do
  [[ -L "$file" || ! -x "$file" ]] || echo "$file"
done || true)
[[ -z "$executable_files" ]] || fail "tracked executable files found: $executable_files"

mkdir -p "$repo_root/.agent"
tmp_dir=$(mktemp -d "$repo_root/.agent/e2e-test-skill.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT
runtime_skill_dir="$tmp_dir/e2e-test"
mkdir -p "$runtime_skill_dir/test"
cp -R "$skill_dir/scripts" "$runtime_skill_dir/scripts"
cp -R "$skill_dir/test/fixtures" "$runtime_skill_dir/test/fixtures"
chmod u+x "$runtime_skill_dir/scripts/"*.sh
chmod u+x "$runtime_skill_dir/test/fixtures/"*.sh "$runtime_skill_dir/test/fixtures/bin/pnpm"
helper="$runtime_skill_dir/scripts/with-machine-user-auth.sh"
supervisor="$runtime_skill_dir/scripts/supervise-process-group.sh"
ids_helper="$runtime_skill_dir/scripts/with-e2e-ids.sh"
runner="$runtime_skill_dir/scripts/run-sdk-e2e.sh"
fixtures="$runtime_skill_dir/test/fixtures"
fake_node="$fixtures/fake-node.sh"
credential_provider="$fixtures/fake-credential-provider.sh"
ids_file="$tmp_dir/ids.local.env"
ids_marker="$tmp_dir/ids-marker"
cat >"$ids_file" <<'EOF'
TAILOR_PLATFORM_WORKSPACE_ID=00000000-0000-4000-8000-000000000000
TAILOR_PLATFORM_ORGANIZATION_ID=00000000-0000-4000-8000-000000000001
TAILOR_PLATFORM_FOLDER_ID=00000000-0000-4000-8000-000000000002
EOF
"$ids_helper" "$ids_file" -- /bin/bash -c '
  printf "%s\n%s\n%s\n" \
    "$TAILOR_PLATFORM_WORKSPACE_ID" \
    "$TAILOR_PLATFORM_ORGANIZATION_ID" \
    "$TAILOR_PLATFORM_FOLDER_ID" >"$1"
' bash "$ids_marker"
[[ $(wc -l <"$ids_marker") -eq 3 ]] || fail "ID loader did not export all stored IDs"

workspace_only_ids_file="$tmp_dir/workspace-only-ids.local.env"
printf '%s\n' \
  'TAILOR_PLATFORM_WORKSPACE_ID=00000000-0000-4000-8000-000000000000' \
  >"$workspace_only_ids_file"
/usr/bin/env \
  TAILOR_PLATFORM_ORGANIZATION_ID=stale-organization \
  TAILOR_PLATFORM_FOLDER_ID=stale-folder \
  "$ids_helper" "$workspace_only_ids_file" -- /bin/bash -c '
    [[ -n ${TAILOR_PLATFORM_WORKSPACE_ID:-} ]]
    [[ -z ${TAILOR_PLATFORM_ORGANIZATION_ID:-} ]]
    [[ -z ${TAILOR_PLATFORM_FOLDER_ID:-} ]]
  '

malicious_ids_file="$tmp_dir/malicious-ids.local.env"
malicious_marker="$tmp_dir/malicious-marker"
printf 'TAILOR_PLATFORM_WORKSPACE_ID=$(touch %s)\n' "$malicious_marker" >"$malicious_ids_file"
set +e
"$ids_helper" "$malicious_ids_file" -- /usr/bin/true
malicious_ids_status=$?
set -e
[[ $malicious_ids_status -eq 64 ]] || fail "ID loader accepted a shell expression"
[[ ! -e "$malicious_marker" ]] || fail "ID loader executed a shell expression"

empty_ids_file="$tmp_dir/empty-ids.local.env"
: >"$empty_ids_file"
set +e
"$ids_helper" "$empty_ids_file" -- /usr/bin/true
empty_ids_status=$?
set -e
[[ $empty_ids_status -eq 64 ]] || fail "ID loader accepted an empty ID file"

auth_marker="$tmp_dir/auth-marker"
auth_argv_marker="$tmp_dir/auth-argv-marker"
target_marker="$tmp_dir/target-marker"
parent_env_marker="$tmp_dir/parent-env-marker"
guardian_command_marker="$tmp_dir/guardian-command-marker"
secret='test-secret-that-must-not-leak'

set +e
missing_output=$(
  env -u TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID \
    -u TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET \
    "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" 2>&1
)
missing_status=$?
set -e
[[ $missing_status -ne 0 ]] || fail "helper accepted missing credentials"
[[ "$missing_output" != *"$secret"* ]] || fail "missing-credential error leaked a secret"

set +e
relative_output=$(
  "$helper" "$fake_node" relative-cli -- "$fixtures/fake-target.sh" \
    3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider") 2>&1
)
relative_status=$?
set -e
[[ $relative_status -ne 0 ]] || fail "helper accepted a relative CLI path"
[[ "$relative_output" != *"$secret"* ]] || fail "CLI-path error leaked the secret"

set +e
relative_node_output=$(
  "$helper" relative-node "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" \
    3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider") 2>&1
)
relative_node_status=$?
set -e
[[ $relative_node_status -ne 0 ]] || fail "helper accepted a relative Node.js path"
[[ "$relative_node_output" != *"$secret"* ]] || fail "Node.js-path error leaked the secret"

output=$(
  /usr/bin/env -i \
    HOME="$HOME" \
    AUTH_MARKER="$auth_marker" \
    AUTH_ARGV_MARKER="$auth_argv_marker" \
    TARGET_MARKER="$target_marker" \
    PARENT_ENV_MARKER="$parent_env_marker" \
    GUARDIAN_COMMAND_MARKER="$guardian_command_marker" \
    TAILOR_PLATFORM_TOKEN=stale-token \
    TAILOR_PLATFORM_PROFILE=developer \
    NODE_OPTIONS=--trace-warnings \
    NODE_PATH=/tmp/untrusted-node-path \
    PATH="/tmp/untrusted-bin:/usr/bin:/bin" \
    PLATFORM_URL=https://untrusted.invalid \
    TAILOR_PLATFORM_URL=https://untrusted.invalid \
    /bin/bash "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" \
    3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider") 2>&1
)
[[ "$output" != *"$secret"* ]] || fail "successful run leaked the secret"
[[ -s "$auth_marker" ]] || fail "authentication command did not run"
[[ -s "$auth_argv_marker" ]] || fail "authentication argv was not captured"
[[ -s "$target_marker" ]] || fail "target command did not run"
[[ -s "$parent_env_marker" ]] || fail "target did not capture its parent environment"
[[ -s "$guardian_command_marker" ]] || fail "target did not capture its guardian command"
if grep -Fq "$secret" "$parent_env_marker"; then
  fail "long-lived parent process retained the client secret"
fi
if grep -Fq "$secret" "$auth_argv_marker"; then
  fail "authentication command exposed the client secret in argv"
fi
if grep -Fq 'with-machine-user-auth.sh' "$guardian_command_marker"; then
  fail "credential-reading helper remained in memory while the target ran"
fi
isolated_config_home=$(<"$auth_marker")
[[ "$isolated_config_home" == "$(<"$target_marker")" ]] ||
  fail "authentication and target used different config homes"
wait_for_path_removal "$isolated_config_home" "temporary config home was not removed"

set +e
xtrace_output=$(
  /bin/bash -x -c '
    export BASH_ENV=/tmp/untrusted-bash-env
    export NODE_OPTIONS=--trace-warnings
    /usr/bin/env -i \
      HOME="$HOME" \
      PATH="/usr/bin:/bin" \
      /bin/bash "$1" "$2" "$3" -- "$4" \
      3< <(set +x; /usr/bin/env -i /bin/bash "$5")
  ' bash "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" "$fixtures/fake-target.sh" \
    "$credential_provider" 2>&1
)
xtrace_status=$?
set -e
[[ $xtrace_status -eq 0 ]] || fail "documented flow failed with caller-side xtrace enabled"
[[ "$xtrace_output" != *"$secret"* ]] || fail "caller-side xtrace leaked the client secret"

failure_marker="$tmp_dir/failure-auth-marker"
set +e
failure_output=$(
  AUTH_MARKER="$failure_marker" \
    FAIL_TARGET=23 \
    "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" \
    3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider") 2>&1
)
failure_status=$?
set -e
[[ $failure_status -eq 23 ]] || fail "target failure status was not preserved"
[[ "$failure_output" != *"$secret"* ]] || fail "failed run leaked the secret"
failed_config_home=$(<"$failure_marker")
wait_for_path_removal "$failed_config_home" "temporary config home survived a failed target"

auth_failure_tmp="$tmp_dir/auth-failure"
mkdir "$auth_failure_tmp"
set +e
auth_failure_output=$(
  TMPDIR="$auth_failure_tmp" \
    "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" \
    3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider" fail-auth) 2>&1
)
auth_failure_status=$?
set -e
[[ $auth_failure_status -eq 22 ]] || fail "authentication failure status was not preserved"
[[ "$auth_failure_output" != *"$secret"* ]] || fail "authentication failure leaked the secret"
wait_for_empty_directory \
  "$auth_failure_tmp" \
  "temporary config home survived an authentication failure"

for auth_signal_case in TERM:143 KILL:137; do
  auth_signal=${auth_signal_case%%:*}
  expected_status=${auth_signal_case##*:}
  auth_kill_tmp="$tmp_dir/auth-$auth_signal"
  mkdir "$auth_kill_tmp"
  TMPDIR="$auth_kill_tmp" \
    "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" \
    3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider" slow-auth) &
  auth_helper_pid=$!
  auth_started_path=""
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    auth_started_path=$(find "$auth_kill_tmp" -name auth-started -print -quit)
    [[ -z "$auth_started_path" ]] || break
    sleep 0.05
  done
  [[ -n "$auth_started_path" ]] || fail "machine-user authentication did not start"
  auth_kill_config_home=${auth_started_path%/auth-started}
  /bin/kill -s "$auth_signal" "$auth_helper_pid"
  set +e
  wait "$auth_helper_pid" 2>/dev/null
  auth_kill_status=$?
  set -e
  [[ $auth_kill_status -eq $expected_status ]] || fail "helper lost $auth_signal during authentication"
  wait_for_path_removal \
    "$auth_kill_config_home" \
    "temporary config home survived $auth_signal during authentication"
  sleep 0.35
  [[ ! -e "$auth_kill_config_home" ]] || fail "authentication child survived helper $auth_signal"
done

auth_race_tmp="$tmp_dir/auth-kill-race"
mkdir "$auth_race_tmp"
TMPDIR="$auth_race_tmp" \
  "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" \
  3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider" kill-parent-auth) &
auth_race_helper_pid=$!
auth_race_started=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  auth_race_started=$(find "$auth_race_tmp" -name auth-race-started -print -quit)
  [[ -z "$auth_race_started" ]] || break
  sleep 0.05
done
[[ -n "$auth_race_started" ]] || fail "authentication race fixture did not start"
auth_race_config_home=${auth_race_started%/auth-race-started}
auth_race_child_pid=$(<"$auth_race_config_home/auth-race-child-pid")
set +e
wait "$auth_race_helper_pid" 2>/dev/null
auth_race_status=$?
set -e
[[ $auth_race_status -eq 137 ]] || fail "authentication race did not kill the helper"
wait_for_process_exit \
  "$auth_race_child_pid" \
  "authentication child survived the helper-to-watchdog handoff race"
wait_for_path_removal \
  "$auth_race_config_home" \
  "temporary config home survived the helper-to-watchdog handoff race"

extra_stream_target_marker="$tmp_dir/extra-stream-target-marker"
set +e
extra_stream_output=$(
  TARGET_MARKER="$extra_stream_target_marker" \
    "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" \
    3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider" extra) 2>&1
)
extra_stream_status=$?
set -e
[[ $extra_stream_status -eq 64 ]] || fail "helper accepted extra credential stream data"
[[ ! -e "$extra_stream_target_marker" ]] || fail "helper ran the target with extra credentials"
[[ "$extra_stream_output" != *"$secret"* ]] || fail "extra credential stream leaked the secret"

orphan_auth_marker="$tmp_dir/orphan-auth-marker"
orphan_pid_marker="$tmp_dir/orphan-pid-marker"
AUTH_MARKER="$orphan_auth_marker" \
  SPAWN_ORPHAN=1 \
  ORPHAN_PID_MARKER="$orphan_pid_marker" \
  "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" \
  3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider")
orphan_config_home=$(<"$orphan_auth_marker")
wait_for_path_removal \
  "$orphan_config_home" \
  "an orphaned target child delayed temporary config cleanup"
wait_for_process_exit \
  "$(<"$orphan_pid_marker")" \
  "target descendant survived normal supervisor exit"

for signal_case in TERM:143 KILL:137; do
  target_signal=${signal_case%%:*}
  expected_status=${signal_case##*:}
  signal_marker="$tmp_dir/signal-$target_signal-marker"
  set +e
  signal_output=$(
    AUTH_MARKER="$signal_marker" \
      TARGET_SIGNAL="$target_signal" \
      "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" \
      3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider") 2>&1
  )
  target_signal_status=$?
  set -e
  [[ $target_signal_status -eq $expected_status ]] || fail "helper lost the $target_signal status"
  [[ "$signal_output" != *"$secret"* ]] || fail "$target_signal run leaked the secret"
  signaled_config_home=$(<"$signal_marker")
  wait_for_path_removal \
    "$signaled_config_home" \
    "temporary config home survived $target_signal"
done

for signal_case in HUP:129 INT:130 TERM:143; do
  parent_signal=${signal_case%%:*}
  expected_status=${signal_case##*:}
  parent_signal_marker="$tmp_dir/parent-signal-$parent_signal-marker"
  parent_signal_completion_marker="$tmp_dir/parent-signal-$parent_signal-completed"
  set +e
  AUTH_MARKER="$parent_signal_marker" \
    TARGET_PARENT_SIGNAL="$parent_signal" \
    TARGET_DELAY=1 \
    TARGET_COMPLETION_MARKER="$parent_signal_completion_marker" \
    "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" \
    3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider")
  parent_signal_status=$?
  set -e
  [[ $parent_signal_status -eq $expected_status ]] || fail "helper lost parent $parent_signal status"
  [[ ! -e "$parent_signal_completion_marker" ]] || fail "helper did not forward parent $parent_signal"
  parent_signal_config_home=$(<"$parent_signal_marker")
  wait_for_path_removal \
    "$parent_signal_config_home" \
    "temporary config home survived parent $parent_signal"
done

guardian_kill_marker="$tmp_dir/guardian-kill-marker"
AUTH_MARKER="$guardian_kill_marker" \
  TARGET_DELAY=2 \
  "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- "$fixtures/fake-target.sh" \
  3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider") &
guardian_pid=$!
wait_for_path "$guardian_kill_marker" "authenticated target did not start before guardian kill"
guardian_kill_config_home=$(<"$guardian_kill_marker")
/bin/kill -KILL "$guardian_pid"
set +e
wait "$guardian_pid" 2>/dev/null
guardian_kill_status=$?
set -e
[[ $guardian_kill_status -eq 137 ]] || fail "helper lost its direct SIGKILL status"
wait_for_path_removal \
  "$guardian_kill_config_home" \
  "temporary config home survived a direct guardian SIGKILL"

pnpm_marker="$tmp_dir/pnpm-marker"
run_id_marker="$tmp_dir/run-id-marker"
e2e_tmpdir_marker="$tmp_dir/e2e-tmpdir-marker"
fake_bin="$fixtures/bin"
run_id="test-run-12345"
organization_id="00000000-0000-4000-8000-000000000001"
folder_id="00000000-0000-4000-8000-000000000002"
export TAILOR_PLATFORM_ORGANIZATION_ID="$organization_id"
export TAILOR_PLATFORM_FOLDER_ID="$folder_id"

nested_group_tmp="$tmp_dir/nested-group"
mkdir "$nested_group_tmp"
nested_group_started="$tmp_dir/nested-group-started"
nested_group_pid_marker="$tmp_dir/nested-group-pid"
nested_group_completion="$tmp_dir/nested-group-completed"
nested_group_pnpm_marker="$tmp_dir/nested-group-pnpm-marker"
TMPDIR="$nested_group_tmp" \
  PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$nested_group_pnpm_marker" \
  E2E_TEST_STARTED_MARKER="$nested_group_started" \
  E2E_TEST_PID_MARKER="$nested_group_pid_marker" \
  E2E_TEST_DELAY=1 \
  E2E_TEST_COMPLETION_MARKER="$nested_group_completion" \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- \
  "$runner" \
  3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider") &
nested_group_helper_pid=$!
wait_for_path "$nested_group_started" "nested e2e test process did not start"
nested_group_test_pid=$(<"$nested_group_pid_marker")
/bin/kill -KILL "$nested_group_helper_pid"
set +e
wait "$nested_group_helper_pid" 2>/dev/null
nested_group_status=$?
set -e
[[ $nested_group_status -eq 137 ]] || fail "nested e2e helper lost its SIGKILL status"
wait_for_process_exit \
  "$nested_group_test_pid" \
  "nested e2e test process survived guardian SIGKILL"
[[ ! -e "$nested_group_completion" ]] || fail "nested e2e test completed after guardian SIGKILL"

nested_cleanup_tmp="$tmp_dir/nested-cleanup"
mkdir "$nested_cleanup_tmp"
nested_cleanup_started="$tmp_dir/nested-cleanup-started"
nested_cleanup_pid_marker="$tmp_dir/nested-cleanup-pid"
nested_cleanup_completion="$tmp_dir/nested-cleanup-completed"
nested_cleanup_pnpm_marker="$tmp_dir/nested-cleanup-pnpm-marker"
TMPDIR="$nested_cleanup_tmp" \
  PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$nested_cleanup_pnpm_marker" \
  E2E_CLEANUP_DELAY_AT=preview \
  E2E_CLEANUP_STARTED_MARKER="$nested_cleanup_started" \
  E2E_CLEANUP_PID_MARKER="$nested_cleanup_pid_marker" \
  E2E_CLEANUP_DELAY=1 \
  E2E_CLEANUP_COMPLETION_MARKER="$nested_cleanup_completion" \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$helper" "$fake_node" "$fixtures/fake-tailor-sdk.sh" -- \
  "$runner" \
  3< <(set +x; /usr/bin/env -i /bin/bash "$credential_provider") &
nested_cleanup_helper_pid=$!
wait_for_path "$nested_cleanup_started" "nested e2e cleanup process did not start"
nested_cleanup_pid=$(<"$nested_cleanup_pid_marker")
/bin/kill -KILL "$nested_cleanup_helper_pid"
set +e
wait "$nested_cleanup_helper_pid" 2>/dev/null
nested_cleanup_status=$?
set -e
[[ $nested_cleanup_status -eq 137 ]] || fail "nested cleanup helper lost its SIGKILL status"
wait_for_process_exit \
  "$nested_cleanup_pid" \
  "nested e2e cleanup process survived guardian SIGKILL"
[[ ! -e "$nested_cleanup_completion" ]] || fail "nested e2e cleanup completed after guardian SIGKILL"

set +e
credential_output=$(
  PATH="$fake_bin:$PATH" \
    E2E_PNPM_MARKER="$pnpm_marker" \
    TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET="$secret" \
    "$runner" 2>&1
)
credential_status=$?
set -e
[[ $credential_status -eq 64 ]] || fail "SDK runner accepted machine-user credentials"
[[ ! -e "$pnpm_marker" ]] || fail "SDK runner started with machine-user credentials present"
[[ "$credential_output" != *"$secret"* ]] || fail "SDK runner leaked the secret"

: >"$pnpm_marker"
set +e
missing_id_output=$(
  env -u TAILOR_PLATFORM_ORGANIZATION_ID \
    -u TAILOR_PLATFORM_FOLDER_ID \
    PATH="$fake_bin:$PATH" \
    E2E_PNPM_MARKER="$pnpm_marker" \
    TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
    "$runner" 2>&1
)
missing_id_status=$?
set -e
[[ $missing_id_status -eq 64 ]] || fail "SDK runner accepted missing organization and folder IDs"
[[ ! -s "$pnpm_marker" ]] || fail "SDK runner started without required IDs"

PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RUN_ID_MARKER="$run_id_marker" \
  E2E_TMPDIR_MARKER="$e2e_tmpdir_marker" \
    TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
    TAILOR_PLATFORM_PROFILE=stale-profile \
    "$runner"
[[ $(wc -l <"$pnpm_marker") -eq 5 ]] ||
  fail "SDK runner did not run test, preview, cleanup, and both verifications"
[[ $(sed -n '1p' "$pnpm_marker") == "run test:e2e" ]] ||
  fail "SDK runner did not invoke the canonical test:e2e script"
[[ $(<"$run_id_marker") == "$run_id" ]] || fail "SDK test did not receive the run ID"
e2e_tmpdir=$(<"$e2e_tmpdir_marker")
[[ "$e2e_tmpdir" == *"tailor-sdk-e2e."* ]] || fail "SDK test did not receive an isolated TMPDIR"
[[ ! -e "$e2e_tmpdir" ]] || fail "SDK runner left its tracking directory behind"
[[ $(sed -n '2p' "$pnpm_marker") == "exec tsx scripts/cleanup-e2e-workspaces.ts --dry-run --run-id=$run_id --workspace-name-prefix=e2e-ws-$run_id-" ]] ||
  fail "SDK cleanup preview command changed"
[[ $(sed -n '3p' "$pnpm_marker") == "exec tailor-sdk --json workspace list" ]] ||
  fail "SDK cleanup pre-audit command changed"
[[ $(sed -n '4p' "$pnpm_marker") == "exec tsx scripts/cleanup-e2e-workspaces.ts --run-id=$run_id --workspace-name-prefix=e2e-ws-$run_id-" ]] ||
  fail "SDK cleanup command changed"
[[ $(sed -n '5p' "$pnpm_marker") == "exec tailor-sdk --json workspace list" ]] ||
  fail "SDK raw cleanup verification command changed"

runner_orphan_pnpm_marker="$tmp_dir/runner-orphan-pnpm-marker"
runner_orphan_pid_marker="$tmp_dir/runner-orphan-pid-marker"
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$runner_orphan_pnpm_marker" \
  E2E_TEST_SPAWN_ORPHAN=1 \
  E2E_TEST_ORPHAN_PID_MARKER="$runner_orphan_pid_marker" \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$runner"
wait_for_process_exit \
  "$(<"$runner_orphan_pid_marker")" \
  "test descendant survived normal SDK runner exit"

outside_cwd_marker="$tmp_dir/outside-cwd-pnpm-marker"
(
  cd "$tmp_dir"
  PATH="$fake_bin:$PATH" \
    E2E_PNPM_MARKER="$outside_cwd_marker" \
    TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
    "$runner"
)
[[ $(wc -l <"$outside_cwd_marker") -eq 5 ]] || fail "SDK runner depended on the caller's cwd"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_TEST_STATUS=23 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$runner"
sdk_failure_status=$?
set -e
[[ $sdk_failure_status -eq 23 ]] || fail "SDK runner lost the test failure status"
[[ $(wc -l <"$pnpm_marker") -eq 5 ]] || fail "SDK runner skipped cleanup after test failure"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_PREVIEW_STATUS=24 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$runner"
preview_failure_status=$?
set -e
[[ $preview_failure_status -eq 24 ]] || fail "SDK runner lost the preview failure status"
[[ $(wc -l <"$pnpm_marker") -eq 2 ]] || fail "SDK runner deleted without a successful preview"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RAW_RESIDUAL=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$runner"
raw_residual_status=$?
set -e
[[ $raw_residual_status -ne 0 ]] || fail "SDK runner accepted raw residual workspace evidence"
[[ $(wc -l <"$pnpm_marker") -eq 7 ]] || fail "SDK runner did not retry residual verification"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RAW_AMBIGUOUS=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$runner"
ambiguous_status=$?
set -e
[[ $ambiguous_status -ne 0 ]] || fail "SDK runner accepted an overlapping cleanup candidate"
[[ $(wc -l <"$pnpm_marker") -eq 3 ]] || fail "SDK runner deleted an ambiguous cleanup candidate"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RAW_MISSING=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$runner"
raw_missing_status=$?
set -e
[[ $raw_missing_status -ne 0 ]] || fail "SDK runner accepted missing raw workspace evidence"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RAW_MALFORMED=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$runner"
raw_malformed_status=$?
set -e
[[ $raw_malformed_status -ne 0 ]] || fail "SDK runner accepted malformed raw workspace evidence"

: >"$pnpm_marker"
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RAW_OTHER_RUN=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$runner"
[[ $(wc -l <"$pnpm_marker") -eq 5 ]] ||
  fail "SDK runner did not keep raw workspace verification scoped to its run ID"

for unsafe_run_id in unsafe/run UPPERCASE12 unsafe.name unsafe_name "$(printf 'a%.0s' {1..41})"; do
  : >"$pnpm_marker"
  set +e
  PATH="$fake_bin:$PATH" \
    E2E_PNPM_MARKER="$pnpm_marker" \
    TAILOR_PLATFORM_E2E_RUN_ID="$unsafe_run_id" \
    "$runner"
  unsafe_run_id_status=$?
  set -e
  [[ $unsafe_run_id_status -eq 64 ]] || fail "SDK runner accepted unsafe run ID: $unsafe_run_id"
  [[ ! -s "$pnpm_marker" ]] || fail "SDK runner started with unsafe run ID: $unsafe_run_id"
done

for signal_case in HUP:129 INT:130 TERM:143; do
  target_signal=${signal_case%%:*}
  expected_status=${signal_case##*:}
  signal_completion_marker="$tmp_dir/runner-signal-$target_signal-completed"
  : >"$pnpm_marker"
  set +e
  PATH="$fake_bin:$PATH" \
    E2E_PNPM_MARKER="$pnpm_marker" \
    E2E_TEST_SIGNAL="$target_signal" \
    E2E_SIGNAL_COMPLETION_MARKER="$signal_completion_marker" \
    TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
    "$runner"
  signal_status=$?
  set -e
  [[ $signal_status -eq $expected_status ]] || fail "SDK runner lost the $target_signal status"
  [[ ! -e "$signal_completion_marker" ]] || fail "SDK runner did not forward $target_signal"
  [[ $(wc -l <"$pnpm_marker") -eq 5 ]] || fail "SDK runner skipped cleanup after $target_signal"
done

ignored_signal_completion_marker="$tmp_dir/runner-signal-ignored-completed"
: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_TEST_SIGNAL=TERM \
  E2E_TEST_IGNORE_SIGNAL=1 \
  E2E_SIGNAL_DELAY=2 \
  E2E_SIGNAL_COMPLETION_MARKER="$ignored_signal_completion_marker" \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$runner"
ignored_signal_status=$?
set -e
[[ $ignored_signal_status -eq 143 ]] || fail "SDK runner lost an ignored TERM status"
[[ ! -e "$ignored_signal_completion_marker" ]] ||
  fail "SDK runner did not escalate an ignored TERM"
[[ $(wc -l <"$pnpm_marker") -eq 5 ]] ||
  fail "SDK runner skipped cleanup after escalating an ignored TERM"

for cleanup_signal_case in preview:HUP:129 pre-audit:INT:130 delete:TERM:143; do
  cleanup_stage=${cleanup_signal_case%%:*}
  cleanup_signal_and_status=${cleanup_signal_case#*:}
  cleanup_signal=${cleanup_signal_and_status%%:*}
  expected_status=${cleanup_signal_and_status##*:}
  : >"$pnpm_marker"
  set +e
  PATH="$fake_bin:$PATH" \
    E2E_PNPM_MARKER="$pnpm_marker" \
    E2E_CLEANUP_SIGNAL_AT="$cleanup_stage" \
    E2E_CLEANUP_SIGNAL="$cleanup_signal" \
    TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
    "$runner"
  cleanup_signal_status=$?
  set -e
  [[ $cleanup_signal_status -eq $expected_status ]] ||
    fail "SDK runner lost $cleanup_signal during $cleanup_stage"
  [[ $(wc -l <"$pnpm_marker") -eq 5 ]] ||
    fail "SDK runner did not finish cleanup after $cleanup_signal during $cleanup_stage"
done

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_CLEANUP_SIGNAL_AT=preview \
  E2E_CLEANUP_SIGNAL=TERM \
  E2E_CLEANUP_SIGNAL_EXIT_IMMEDIATELY=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$runner"
cleanup_exit_race_status=$?
set -e
[[ $cleanup_exit_race_status -eq 143 ]] || fail "SDK runner lost the cleanup race signal status"
[[ $(wc -l <"$pnpm_marker") -eq 5 ]] ||
  fail "SDK runner aborted cleanup when the signaled child exited immediately"

node -e '
  const scripts = JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).scripts;
  if (scripts["check:e2e-test-skill"] !== "bash .agents/skills/e2e-test/test/skill.test.sh") process.exit(1);
' || fail "e2e-test skill checks are not registered in the root check"
grep -q 'pnpm run check:e2e-test-skill' "$repo_root/.github/workflows/ci.yml" ||
  fail "e2e-test skill checks are not registered in CI"

echo "e2e-test skill checks passed"
