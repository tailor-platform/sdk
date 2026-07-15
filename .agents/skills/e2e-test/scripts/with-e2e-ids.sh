#!/bin/bash

set -euo pipefail

usage() {
  echo "Usage: $0 <ids.local.env> -- <command> [args...]" >&2
}

if [[ $# -lt 3 || ${2:-} != "--" ]]; then
  usage
  exit 64
fi

ids_file=$1
shift 2

if [[ ! -r "$ids_file" ]]; then
  echo "Stored e2e ID file is missing or unreadable: $ids_file" >&2
  exit 64
fi

workspace_id=""
organization_id=""
folder_id=""
workspace_seen=0
organization_seen=0
folder_seen=0

while IFS= read -r line || [[ -n "$line" ]]; do
  case "$line" in
    "" | \#*) continue ;;
    TAILOR_PLATFORM_WORKSPACE_ID=*)
      key=TAILOR_PLATFORM_WORKSPACE_ID
      value=${line#*=}
      [[ $workspace_seen -eq 0 ]] || {
        echo "Duplicate ID entry: $key" >&2
        exit 64
      }
      workspace_seen=1
      workspace_id=$value
      ;;
    TAILOR_PLATFORM_ORGANIZATION_ID=*)
      key=TAILOR_PLATFORM_ORGANIZATION_ID
      value=${line#*=}
      [[ $organization_seen -eq 0 ]] || {
        echo "Duplicate ID entry: $key" >&2
        exit 64
      }
      organization_seen=1
      organization_id=$value
      ;;
    TAILOR_PLATFORM_FOLDER_ID=*)
      key=TAILOR_PLATFORM_FOLDER_ID
      value=${line#*=}
      [[ $folder_seen -eq 0 ]] || {
        echo "Duplicate ID entry: $key" >&2
        exit 64
      }
      folder_seen=1
      folder_id=$value
      ;;
    *)
      echo "Unsupported line in stored e2e ID file." >&2
      exit 64
      ;;
  esac

  if [[ ! "$value" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$ ]]; then
    echo "$key must contain a UUID." >&2
    exit 64
  fi
done <"$ids_file"

if [[ $workspace_seen -eq 0 && $organization_seen -eq 0 && $folder_seen -eq 0 ]]; then
  echo "Stored e2e ID file does not contain any supported IDs." >&2
  exit 64
fi

environment=()
[[ $workspace_seen -eq 0 ]] || environment+=("TAILOR_PLATFORM_WORKSPACE_ID=$workspace_id")
[[ $organization_seen -eq 0 ]] || environment+=("TAILOR_PLATFORM_ORGANIZATION_ID=$organization_id")
[[ $folder_seen -eq 0 ]] || environment+=("TAILOR_PLATFORM_FOLDER_ID=$folder_id")

exec /usr/bin/env "${environment[@]}" "$@"
