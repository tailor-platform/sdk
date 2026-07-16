#!/bin/bash

set +x
set -euo pipefail

usage() {
  echo "Usage: $0 /absolute/path/to/trusted/node /absolute/path/to/trusted/tailor-sdk -- <command> [args...] (credentials on FD 3)" >&2
}

script_path=${BASH_SOURCE[0]}
[[ "$script_path" == /* ]] || script_path="$PWD/$script_path"
script_dir=${script_path%/*}
supervisor="$script_dir/supervise-process-group.sh"
if [[ ! -r "$supervisor" ]]; then
  echo "Process-group supervisor is missing." >&2
  exit 1
fi

if [[ $# -lt 4 || ${3:-} != "--" ]]; then
  usage
  exit 64
fi

auth_node=$1
auth_cli=$2
shift 3

if [[ "$auth_node" != /* || ! -x "$auth_node" ]]; then
  echo "Trusted Node.js path must be absolute and executable." >&2
  exit 64
fi

if [[ "$auth_cli" != /* || ! -r "$auth_cli" ]]; then
  echo "Trusted tailor-sdk path must be absolute and readable." >&2
  exit 64
fi

if [[ -n ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID:-} || -n ${TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET:-} ]]; then
  echo "Machine-user credentials must be supplied on file descriptor 3, not in the environment." >&2
  exit 64
fi

client_id=""
client_secret=""
if ! IFS= read -r -d '' client_id 2>/dev/null <&3 ||
  ! IFS= read -r -d '' client_secret 2>/dev/null <&3; then
  echo "File descriptor 3 must contain a NUL-terminated client ID and client secret." >&2
  exit 64
fi
extra_byte=$(/usr/bin/od -An -N1 -tu1 <&3)
exec 3<&-

if [[ -z "$client_id" || -z "$client_secret" ]]; then
  echo "The client ID and client secret on file descriptor 3 must be non-empty." >&2
  exit 64
fi
if [[ -n ${extra_byte//[[:space:]]/} ]]; then
  echo "File descriptor 3 must contain exactly two NUL-terminated values." >&2
  exit 64
fi
unset extra_byte

config_home=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/tailor-e2e-auth.XXXXXX")
/bin/chmod 700 "$config_home"
/bin/mkdir -p "$config_home/home"
cleanup_config() {
  /bin/rm -rf -- "$config_home"
}
trap cleanup_config EXIT

helper_pid=$$
managed_supervisor_pid=""
handle_signal() {
  local signal_name=$1 signal_status=$2
  trap - HUP INT TERM
  if [[ "$managed_supervisor_pid" =~ ^[0-9]+$ ]]; then
    kill -s "$signal_name" "$managed_supervisor_pid" 2>/dev/null || true
    wait "$managed_supervisor_pid" 2>/dev/null || true
  fi
  exit "$signal_status"
}
trap 'handle_signal HUP 129' HUP
trap 'handle_signal INT 130' INT
trap 'handle_signal TERM 143' TERM

set +e
set -m
/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash "$supervisor" \
  "$helper_pid" "$config_home" 4 escalate -- \
  /usr/bin/env -i \
  HOME="$config_home/home" \
  XDG_CONFIG_HOME="$config_home" \
  /bin/bash -c '
    set +x
    IFS= read -r -d "" client_id <&4 || exit 64
    IFS= read -r -d "" client_secret <&4 || exit 64
    exec 4<&-
    export TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID="$client_id"
    export TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET="$client_secret"
    exec "$1" "$2" login --machine-user
  ' bash "$auth_node" "$auth_cli" \
  4< <(printf '%s\0%s\0' "$client_id" "$client_secret") &
managed_supervisor_pid=$!
set +m
unset client_id client_secret
wait "$managed_supervisor_pid"
auth_status=$?
set -e
managed_supervisor_pid=""

if [[ $auth_status -ne 0 ]]; then
  exit "$auth_status"
fi

exec /usr/bin/env -u TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID \
  -u TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET \
  -u TAILOR_PLATFORM_TOKEN \
  -u TAILOR_TOKEN \
  -u TAILOR_PLATFORM_PROFILE \
  -u TAILOR_USE_KEYRING \
  -u NODE_OPTIONS \
  -u NODE_PATH \
  -u TAILOR_PLATFORM_URL \
  -u PLATFORM_URL \
  -u BASH_ENV \
  -u ENV \
  XDG_CONFIG_HOME="$config_home" \
  TAILOR_E2E_TRUSTED_NODE="$auth_node" \
  TAILOR_E2E_TRUSTED_CLI="$auth_cli" \
  /bin/bash -c '
    set -uo pipefail
    supervisor=$1
    config_home=$2
    shift 2

    cleanup_config() {
      /bin/rm -rf -- "$config_home"
    }
    trap cleanup_config EXIT

    managed_supervisor_pid=""
    handle_signal() {
      signal_name=$1
      signal_status=$2
      trap - HUP INT TERM
      if [[ "$managed_supervisor_pid" =~ ^[0-9]+$ ]]; then
        kill -s "$signal_name" "$managed_supervisor_pid" 2>/dev/null || true
        wait "$managed_supervisor_pid" 2>/dev/null || true
      fi
      exit "$signal_status"
    }
    trap "handle_signal HUP 129" HUP
    trap "handle_signal INT 130" INT
    trap "handle_signal TERM 143" TERM

    guardian_pid=$$
    set -m
    /bin/bash "$supervisor" "$guardian_pid" "$config_home" - wait -- "$@" &
    managed_supervisor_pid=$!
    set +m
    wait "$managed_supervisor_pid"
    target_status=$?
    managed_supervisor_pid=""
    exit "$target_status"
  ' bash "$supervisor" "$config_home" "$@"
