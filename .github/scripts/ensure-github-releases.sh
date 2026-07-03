#!/usr/bin/env bash
# Creates a GitHub release (and its underlying tag) for every non-private
# workspace package whose version was introduced at the current commit.
#
# `gh release create <tag> --target <sha>` creates the tag via the GitHub API
# when it doesn't already exist, so this needs no local git tag/push and no
# git identity — sidestepping the class of failure where `changeset publish`
# (invoked with --no-git-tag, see release.yml) or its underlying `git tag`
# would otherwise need a configured committer.
#
# This runs on every push to main, not just publishes, so it only acts on
# packages whose version differs from HEAD^ (requires fetch-depth: 2 in the
# checkout step). Without that guard, an unrelated later push would "fix" an
# older missing release by tagging it at the wrong (much later) commit.
#
# All package metadata (name, version, private, changelog) is read from git
# object history via `git show <sha>:<path>`, never from the working tree.
# When pending changesets exist, `changesets/action` runs `changeset version`
# locally to prepare the release PR diff — this bumps package.json/CHANGELOG.md
# on disk without ever committing that bump to the current HEAD. Reading the
# working tree here would treat that uncommitted bump as "introduced at HEAD"
# and create a release for a version that was never actually published.
#
# Idempotent: packages whose version already has a release are skipped. Also
# doubles as the regression guard for the release workflow — if release
# creation fails for a just-published version, this step (and the job) fails
# instead of the gap going unnoticed.
set -euo pipefail

notes_file=""
trap '[ -n "$notes_file" ] && rm -f "$notes_file"' EXIT

sha="$(git rev-parse HEAD)"
parent="$(git rev-parse HEAD^ 2>/dev/null || true)"

# <package.json path> <commit> -> "name<TAB>version<TAB>private", or empty if
# the path doesn't exist at that commit (e.g. a newly added package, or no
# parent commit). `|| true` makes that a non-fatal empty result instead of
# aborting the script under `set -e`.
pkg_at() {
  [ -n "$2" ] || return 0
  git show "${2}:${1}" 2>/dev/null | node -pe "
    const p = JSON.parse(require('fs').readFileSync(0,'utf8'));
    [p.name, p.version, !!p.private].join('\t')
  " 2>/dev/null || true
}

changelog_entry() { # <version> — reads full changelog content from stdin
  awk -v ver="## $1" '
    $0 == ver { found = 1; next }
    found && /^## / { exit }
    found { print }
  '
}

for pkg_json in packages/*/package.json; do
  dir="$(dirname "$pkg_json")"

  head_line="$(pkg_at "$pkg_json" "$sha")"
  [ -n "$head_line" ] || continue
  IFS=$'\t' read -r name version private <<<"$head_line"
  [ "$private" = "true" ] && continue

  parent_line="$(pkg_at "$pkg_json" "$parent")"
  prev_version=""
  [ -n "$parent_line" ] && IFS=$'\t' read -r _ prev_version _ <<<"$parent_line"
  [ "$prev_version" = "$version" ] && continue

  tag="${name}@${version}"
  if gh release view "$tag" >/dev/null 2>&1; then
    continue
  fi

  echo "Creating GitHub release ${tag}"
  prerelease=()
  case "$version" in *-*) prerelease=(--prerelease) ;; esac

  changelog="$(git show "${sha}:${dir}/CHANGELOG.md" 2>/dev/null)" || true

  # A version heading may exist with an empty body (e.g. packages with no
  # direct changes), which is a valid empty release. Only fall back to
  # auto-generated notes when the heading is missing entirely.
  if grep -qxF "## ${version}" <<<"$changelog"; then
    notes_file="$(mktemp)"
    changelog_entry "$version" <<<"$changelog" >"$notes_file"
    gh release create "$tag" --target "$sha" --title "$tag" --notes-file "$notes_file" "${prerelease[@]}"
    rm -f "$notes_file"
    notes_file=""
  else
    echo "No changelog entry for ${tag}; generating release notes"
    gh release create "$tag" --target "$sha" --title "$tag" --generate-notes "${prerelease[@]}"
  fi
done
