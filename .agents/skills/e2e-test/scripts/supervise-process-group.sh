#!/bin/bash

set +x
set -uo pipefail

usage() {
  echo "Usage: $0 <parent-pid> <cleanup-path> <inherited-fd|-> -- <command> [args...]" >&2
}

if [[ $# -lt 5 || ${4:-} != "--" ]]; then
  usage
  exit 64
fi

parent_pid=$1
cleanup_path=$2
inherited_fd=$3
shift 4

if [[ ! "$parent_pid" =~ ^[0-9]+$ || "$cleanup_path" != /* ]]; then
  usage
  exit 64
fi
if [[ "$inherited_fd" != "-" && ! "$inherited_fd" =~ ^[3-9]$ ]]; then
  usage
  exit 64
fi
child_pid=""
forwarded_status=0

parent_is_alive() {
  kill -0 "$parent_pid" 2>/dev/null
}

remove_cleanup_path() {
  /bin/rm -rf -- "$cleanup_path"
}

forward_signal() {
  local signal_name=$1 signal_status=$2
  [[ $forwarded_status -ne 0 ]] || forwarded_status=$signal_status
  if [[ "$child_pid" =~ ^[0-9]+$ ]]; then
    kill -s "$signal_name" -- "-$child_pid" 2>/dev/null || true
  fi
}
trap 'forward_signal HUP 129' HUP
trap 'forward_signal INT 130' INT
trap 'forward_signal TERM 143' TERM

if ! parent_is_alive; then
  remove_cleanup_path
  exit 137
fi

set -m
"$@" &
child_pid=$!
set +m

case "$inherited_fd" in
  -) ;;
  3) exec 3<&- ;;
  4) exec 4<&- ;;
  5) exec 5<&- ;;
  6) exec 6<&- ;;
  7) exec 7<&- ;;
  8) exec 8<&- ;;
  9) exec 9<&- ;;
esac

parent_lost=0
while kill -0 "$child_pid" 2>/dev/null; do
  if ! parent_is_alive; then
    parent_lost=1
    kill -KILL -- "-$child_pid" 2>/dev/null || true
    break
  fi
  /bin/sleep 0.05
done

wait "$child_pid" 2>/dev/null
child_status=$?

if [[ $parent_lost -eq 1 ]] || ! parent_is_alive; then
  kill -KILL -- "-$child_pid" 2>/dev/null || true
  wait "$child_pid" 2>/dev/null || true
  remove_cleanup_path
  exit 137
fi
if [[ $forwarded_status -ne 0 ]]; then
  exit "$forwarded_status"
fi
exit "$child_status"
