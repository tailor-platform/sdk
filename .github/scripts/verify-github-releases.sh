#!/usr/bin/env bash
# Every non-private workspace package's checked-out version should have a
# matching GitHub release. This catches a silently-failed tag/release step
# (e.g. `git tag` failing without a git identity, or changesets/action
# failing to detect a publish) as a failed CI run instead of a release that
# quietly never appears.
set -euo pipefail

missing=0
for pkg_json in packages/*/package.json; do
  private="$(node -p "!!require('./${pkg_json}').private")"
  [ "$private" = "true" ] && continue

  name="$(node -p "require('./${pkg_json}').name")"
  version="$(node -p "require('./${pkg_json}').version")"
  tag="${name}@${version}"

  if ! gh release view "$tag" >/dev/null 2>&1; then
    echo "::error::No GitHub release found for ${tag}"
    missing=1
  fi
done

exit "$missing"
