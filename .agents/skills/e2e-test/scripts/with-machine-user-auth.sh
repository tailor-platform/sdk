#!/bin/bash

set +x
set -euo pipefail

usage() {
  echo "Usage: $0 /absolute/path/to/trusted/node /absolute/path/to/trusted/tailor-sdk -- <command> [args...] (credentials on FD 3)" >&2
}

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
managed_pid_file="$config_home/.managed-pgid"
cleanup_config() {
  /bin/rm -rf -- "$config_home"
}
trap cleanup_config EXIT

helper_pid=$$
/usr/bin/env -i PATH=/usr/bin:/bin /bin/bash -c '
  trap "" HUP INT TERM
  helper_pid=$1
  config_home=$2
  managed_pid_file=$3

  managed_pid=""
  observed_candidate=""
  while kill -0 "$helper_pid" 2>/dev/null; do
    candidate_pid=""
    if [[ -r "$managed_pid_file" ]]; then
      IFS= read -r candidate_pid <"$managed_pid_file" || true
    fi
    if [[ "$candidate_pid" != "$observed_candidate" ]]; then
      observed_candidate=$candidate_pid
      candidate_parent=""
      if [[ "$candidate_pid" =~ ^[0-9]+$ ]]; then
        candidate_parent=$(/bin/ps -o ppid= -p "$candidate_pid" 2>/dev/null | /usr/bin/tr -d " ")
      fi
      if [[ "$candidate_parent" == "$helper_pid" ]]; then
        managed_pid=$candidate_pid
      else
        managed_pid=""
      fi
    fi
    /bin/sleep 0.05
  done

  if [[ "$managed_pid" =~ ^[0-9]+$ ]]; then
    kill -KILL -- "-$managed_pid" 2>/dev/null || true
  else
    for child_pid in $(/usr/bin/pgrep -P "$helper_pid" 2>/dev/null); do
      if [[ "$child_pid" != "$$" ]]; then
        kill -KILL -- "-$child_pid" 2>/dev/null || kill -KILL "$child_pid" 2>/dev/null || true
      fi
    done
  fi
  /bin/rm -rf -- "$config_home"
' bash "$helper_pid" "$config_home" "$managed_pid_file" </dev/null >/dev/null 2>&1 &

auth_pid=""
handle_auth_signal() {
  local signal_name=$1 signal_status=$2
  trap - HUP INT TERM
  if [[ "$auth_pid" =~ ^[0-9]+$ ]]; then
    kill -s "$signal_name" -- "-$auth_pid" 2>/dev/null || true
    wait "$auth_pid" 2>/dev/null || true
  fi
  /bin/rm -f -- "$managed_pid_file"
  exit "$signal_status"
}
trap 'handle_auth_signal HUP 129' HUP
trap 'handle_auth_signal INT 130' INT
trap 'handle_auth_signal TERM 143' TERM

set +e
set -m
/usr/bin/env -i \
  HOME="$config_home/home" \
  XDG_CONFIG_HOME="$config_home" \
  /bin/bash -c '
    set +x
    IFS= read -r -d "" client_id || exit 64
    IFS= read -r -d "" client_secret || exit 64
    export TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID="$client_id"
    export TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET="$client_secret"
    exec "$1" "$2" login --machine-user
  ' bash "$auth_node" "$auth_cli" < <(printf '%s\0%s\0' "$client_id" "$client_secret") &
auth_pid=$!
set +m
printf '%s\n' "$auth_pid" >"$managed_pid_file"
wait "$auth_pid"
auth_status=$?
/bin/rm -f -- "$managed_pid_file"
set -e
unset auth_pid client_id client_secret

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
    config_home=$1
    shift
    managed_pid_file="$config_home/.managed-pgid"

    cleanup_and_exit() {
      status=$1
      trap - HUP INT TERM
      /bin/rm -rf -- "$config_home"
      exit "$status"
    }

    forward_signal() {
      signal_name=$1
      signal_status=$2
      trap - HUP INT TERM
      kill -s "$signal_name" -- "-$target_pid" 2>/dev/null || true
      wait "$target_pid" 2>/dev/null || true
      cleanup_and_exit "$signal_status"
    }

    set -m
    "$@" &
    target_pid=$!
    set +m
    printf "%s\n" "$target_pid" >"$managed_pid_file"
    trap "forward_signal HUP 129" HUP
    trap "forward_signal INT 130" INT
    trap "forward_signal TERM 143" TERM

    wait "$target_pid"
    target_status=$?
    cleanup_and_exit "$target_status"
  ' bash "$config_home" "$@"
