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
exec 3<&-

if [[ -z "$client_id" || -z "$client_secret" ]]; then
  echo "The client ID and client secret on file descriptor 3 must be non-empty." >&2
  exit 64
fi

config_home=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/tailor-e2e-auth.XXXXXX")
/bin/chmod 700 "$config_home"
/bin/mkdir -p "$config_home/home"
lifetime_fifo="$config_home/.lifetime"
/usr/bin/mkfifo "$lifetime_fifo"

/usr/bin/env -i \
  PATH=/usr/bin:/bin \
  /bin/bash -c '
    trap "" HUP INT TERM
    lifetime_fifo=$1
    config_home=$2
    IFS= read -r _ <"$lifetime_fifo" || true
    rm -rf -- "$config_home"
  ' bash "$lifetime_fifo" "$config_home" </dev/null >/dev/null 2>&1 &

exec 9>"$lifetime_fifo"
/bin/rm -f "$lifetime_fifo"

set +e
printf '%s\0%s\0' "$client_id" "$client_secret" | /usr/bin/env -i \
  HOME="$config_home/home" \
  XDG_CONFIG_HOME="$config_home" \
  /bin/bash -c '
    set +x
    IFS= read -r -d "" client_id || exit 64
    IFS= read -r -d "" client_secret || exit 64
    export TAILOR_PLATFORM_MACHINE_USER_CLIENT_ID="$client_id"
    export TAILOR_PLATFORM_MACHINE_USER_CLIENT_SECRET="$client_secret"
    exec "$1" "$2" login --machine-user
  ' bash "$auth_node" "$auth_cli"
auth_status=$?
set -e
unset client_id client_secret

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
  "$@"
