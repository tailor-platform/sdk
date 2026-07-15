#!/usr/bin/env bash

set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
skill_dir="$repo_root/.agents/skills/e2e-test"
helper="$skill_dir/scripts/with-machine-user-auth.sh"
fixtures="$skill_dir/test/fixtures"
fake_node="$fixtures/fake-node.sh"
credential_provider="$fixtures/fake-credential-provider.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

[[ ! -f "$repo_root/.agents/skills/e2e-setup/SKILL.md" ]] || fail "legacy SKILL.md remains"
[[ ! -f "$repo_root/.agents/skills/e2e-setup/.gitignore" ]] || fail "legacy skill ignore remains"
[[ -f "$skill_dir/SKILL.md" ]] || fail "SKILL.md is missing"
[[ -f "$skill_dir/AUTH.md" ]] || fail "AUTH.md is missing"
[[ -f "$skill_dir/SUITES.md" ]] || fail "SUITES.md is missing"
[[ -x "$helper" ]] || fail "authentication helper is not executable"
[[ $(wc -l <"$skill_dir/SKILL.md") -le 100 ]] || fail "SKILL.md exceeds 100 lines"
grep -q '^name: e2e-test$' "$skill_dir/SKILL.md" || fail "skill name was not updated"
grep -q '!.claude/skills/e2e-test' "$repo_root/.gitignore" || fail "new skill is ignored"
if grep -q '!.claude/skills/e2e-setup' "$repo_root/.gitignore"; then
  fail "legacy skill ignore exception remains"
fi
[[ -L "$repo_root/.claude/skills/e2e-test" ]] || fail "Claude compatibility symlink is missing"
[[ $(readlink "$repo_root/.claude/skills/e2e-test") == "../../.agents/skills/e2e-test" ]] ||
  fail "Claude compatibility symlink points to the wrong target"
git check-ignore -q .agents/skills/e2e-setup/ids.local.env ||
  fail "legacy local ID file is not ignored during migration"

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT
auth_marker="$tmp_dir/auth-marker"
auth_argv_marker="$tmp_dir/auth-argv-marker"
target_marker="$tmp_dir/target-marker"
parent_env_marker="$tmp_dir/parent-env-marker"
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
if grep -Fq "$secret" "$parent_env_marker"; then
  fail "long-lived parent process retained the client secret"
fi
if grep -Fq "$secret" "$auth_argv_marker"; then
  fail "authentication command exposed the client secret in argv"
fi
isolated_config_home=$(<"$auth_marker")
[[ "$isolated_config_home" == "$(<"$target_marker")" ]] ||
  fail "authentication and target used different config homes"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ ! -e "$isolated_config_home" ]] && break
  sleep 0.05
done
[[ ! -e "$isolated_config_home" ]] || fail "temporary config home was not removed"

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
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ ! -e "$failed_config_home" ]] && break
  sleep 0.05
done
[[ ! -e "$failed_config_home" ]] || fail "temporary config home survived a failed target"

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
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [[ -z $(find "$auth_failure_tmp" -mindepth 1 -maxdepth 1 -print -quit) ]] && break
  sleep 0.05
done
[[ -z $(find "$auth_failure_tmp" -mindepth 1 -maxdepth 1 -print -quit) ]] ||
  fail "temporary config home survived an authentication failure"

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
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [[ ! -e "$signaled_config_home" ]] && break
    sleep 0.05
  done
  [[ ! -e "$signaled_config_home" ]] || fail "temporary config home survived $target_signal"
done

pnpm_marker="$tmp_dir/pnpm-marker"
run_id_marker="$tmp_dir/run-id-marker"
e2e_tmpdir_marker="$tmp_dir/e2e-tmpdir-marker"
fake_bin="$fixtures/bin"
run_id="test-run-12345"

set +e
credential_output=$(
  PATH="$fake_bin:$PATH" \
    E2E_PNPM_MARKER="$pnpm_marker" \
    TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET="$secret" \
    "$skill_dir/scripts/run-sdk-e2e.sh" 2>&1
)
credential_status=$?
set -e
[[ $credential_status -eq 64 ]] || fail "SDK runner accepted machine-user credentials"
[[ ! -e "$pnpm_marker" ]] || fail "SDK runner started with machine-user credentials present"
[[ "$credential_output" != *"$secret"* ]] || fail "SDK runner leaked the secret"

PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RUN_ID_MARKER="$run_id_marker" \
  E2E_TMPDIR_MARKER="$e2e_tmpdir_marker" \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$skill_dir/scripts/run-sdk-e2e.sh"
[[ $(wc -l <"$pnpm_marker") -eq 5 ]] ||
  fail "SDK runner did not run test, preview, cleanup, and both verifications"
[[ $(sed -n '1p' "$pnpm_marker") == "run test -- --project e2e" ]] ||
  fail "SDK test command changed"
[[ $(<"$run_id_marker") == "$run_id" ]] || fail "SDK test did not receive the run ID"
e2e_tmpdir=$(<"$e2e_tmpdir_marker")
[[ "$e2e_tmpdir" == *"tailor-sdk-e2e."* ]] || fail "SDK test did not receive an isolated TMPDIR"
[[ ! -e "$e2e_tmpdir" ]] || fail "SDK runner left its tracking directory behind"
[[ $(sed -n '2p' "$pnpm_marker") == "exec tsx scripts/cleanup-e2e-workspaces.ts --dry-run --run-id=$run_id" ]] ||
  fail "SDK cleanup preview command changed"
[[ $(sed -n '3p' "$pnpm_marker") == "exec tsx scripts/cleanup-e2e-workspaces.ts --run-id=$run_id" ]] ||
  fail "SDK cleanup command changed"
[[ $(sed -n '4p' "$pnpm_marker") == "exec tsx scripts/cleanup-e2e-workspaces.ts --dry-run --run-id=$run_id" ]] ||
  fail "SDK cleanup verification command changed"
[[ $(sed -n '5p' "$pnpm_marker") == "exec tailor-sdk --json workspace list" ]] ||
  fail "SDK raw workspace verification command changed"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_TEST_STATUS=23 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$skill_dir/scripts/run-sdk-e2e.sh"
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
  "$skill_dir/scripts/run-sdk-e2e.sh"
preview_failure_status=$?
set -e
[[ $preview_failure_status -eq 24 ]] || fail "SDK runner lost the preview failure status"
[[ $(wc -l <"$pnpm_marker") -eq 2 ]] || fail "SDK runner deleted without a successful preview"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RESIDUAL_WORKSPACE=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$skill_dir/scripts/run-sdk-e2e.sh"
residual_status=$?
set -e
[[ $residual_status -ne 0 ]] || fail "SDK runner accepted a residual workspace"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_VERIFY_MISSING=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$skill_dir/scripts/run-sdk-e2e.sh"
missing_evidence_status=$?
set -e
[[ $missing_evidence_status -ne 0 ]] || fail "SDK runner accepted missing cleanup evidence"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_VERIFY_MALFORMED=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$skill_dir/scripts/run-sdk-e2e.sh"
malformed_evidence_status=$?
set -e
[[ $malformed_evidence_status -ne 0 ]] || fail "SDK runner accepted contradictory cleanup evidence"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RAW_RESIDUAL=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$skill_dir/scripts/run-sdk-e2e.sh"
raw_residual_status=$?
set -e
[[ $raw_residual_status -ne 0 ]] || fail "SDK runner accepted raw residual workspace evidence"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RAW_MISSING=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$skill_dir/scripts/run-sdk-e2e.sh"
raw_missing_status=$?
set -e
[[ $raw_missing_status -ne 0 ]] || fail "SDK runner accepted missing raw workspace evidence"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RAW_MALFORMED=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$skill_dir/scripts/run-sdk-e2e.sh"
raw_malformed_status=$?
set -e
[[ $raw_malformed_status -ne 0 ]] || fail "SDK runner accepted malformed raw workspace evidence"

: >"$pnpm_marker"
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_RAW_OTHER_RUN=1 \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$skill_dir/scripts/run-sdk-e2e.sh"
[[ $(wc -l <"$pnpm_marker") -eq 5 ]] ||
  fail "SDK runner did not keep raw workspace verification scoped to its run ID"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  TAILOR_PLATFORM_E2E_RUN_ID=unsafe/run \
  "$skill_dir/scripts/run-sdk-e2e.sh"
unsafe_run_id_status=$?
set -e
[[ $unsafe_run_id_status -eq 64 ]] || fail "SDK runner accepted an unsafe run ID"
[[ ! -s "$pnpm_marker" ]] || fail "SDK runner started with an unsafe run ID"

: >"$pnpm_marker"
set +e
PATH="$fake_bin:$PATH" \
  E2E_PNPM_MARKER="$pnpm_marker" \
  E2E_TEST_SIGNAL=TERM \
  TAILOR_PLATFORM_E2E_RUN_ID="$run_id" \
  "$skill_dir/scripts/run-sdk-e2e.sh"
signal_status=$?
set -e
[[ $signal_status -eq 143 ]] || fail "SDK runner lost the termination status"
[[ $(wc -l <"$pnpm_marker") -eq 5 ]] || fail "SDK runner skipped cleanup after termination"

echo "e2e-test skill checks passed"
