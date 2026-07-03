#!/usr/bin/env bash
# Creates a GitHub release (and its underlying tag) for every non-private
# workspace package whose checked-out version doesn't have one yet.
#
# `gh release create <tag> --target <sha>` creates the tag via the GitHub API
# when it doesn't already exist, so this needs no local git tag/push and no
# git identity — sidestepping the class of failure where `changeset publish`
# (invoked with --no-git-tag, see release.yml) or its underlying `git tag`
# would otherwise need a configured committer.
#
# Idempotent: packages whose version already has a release are skipped. Also
# doubles as the regression guard for the release workflow — if release
# creation fails for a just-published version, this step (and the job) fails
# instead of the gap going unnoticed.
set -euo pipefail

sha="$(git rev-parse HEAD)"

changelog_entry() { # <changelog-file> <version>
  awk -v ver="## $2" '
    $0 == ver { found = 1; next }
    found && /^## / { exit }
    found { print }
  ' "$1"
}

for pkg_json in packages/*/package.json; do
  private="$(node -p "!!require('./${pkg_json}').private")"
  [ "$private" = "true" ] && continue

  name="$(node -p "require('./${pkg_json}').name")"
  version="$(node -p "require('./${pkg_json}').version")"
  dir="$(dirname "$pkg_json")"
  tag="${name}@${version}"

  if gh release view "$tag" >/dev/null 2>&1; then
    continue
  fi

  echo "Creating GitHub release ${tag}"
  prerelease=()
  case "$version" in *-*) prerelease=(--prerelease) ;; esac

  # A version heading may exist with an empty body (e.g. packages with no
  # direct changes), which is a valid empty release. Only fall back to
  # auto-generated notes when the heading is missing entirely.
  if grep -qxF "## ${version}" "${dir}/CHANGELOG.md" 2>/dev/null; then
    notes_file="$(mktemp)"
    changelog_entry "${dir}/CHANGELOG.md" "$version" >"$notes_file"
    gh release create "$tag" --target "$sha" --title "$tag" --notes-file "$notes_file" "${prerelease[@]}"
    rm -f "$notes_file"
  else
    echo "No changelog entry for ${tag}; generating release notes"
    gh release create "$tag" --target "$sha" --title "$tag" --generate-notes "${prerelease[@]}"
  fi
done
