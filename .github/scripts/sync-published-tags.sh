#!/usr/bin/env bash
# changesets/action (<= v1.9.0) detects published packages by parsing the
# legacy `New tag: <pkg>@<version>` lines from `changeset publish`. Since
# @changesets/cli v3 the publish output is `Created git tags.` with no
# per-tag lines, so the action finds nothing, leaves `published` false, and
# skips pushing tags and creating GitHub releases even though the packages
# were published to npm and tagged locally.
#
# This pushes any local tags created at the current commit that are missing on
# the remote and creates a matching GitHub release. It is idempotent: tags
# already on the remote and releases that already exist are skipped.
set -euo pipefail

# Authenticate git through gh's credential helper so the token is never
# embedded in a remote URL (which could leak into logs or process args).
gh auth setup-git

notes_file=""
trap '[ -n "$notes_file" ] && rm -f "$notes_file"' EXIT

changelog_entry() { # <changelog-file> <version>
  awk -v ver="## $2" '
    $0 == ver { found = 1; next }
    found && /^## / { exit }
    found { print }
  ' "$1"
}

pkg_dir_for() { # <package-name> -> package directory
  for pj in packages/*/package.json; do
    if [ "$(node -p "require('./${pj}').name")" = "$1" ]; then
      dirname "$pj"
      return 0
    fi
  done
  return 1
}

for tag in $(git tag --points-at HEAD); do
  # Only handle Changesets package tags of the form "<pkg>@<version>", skipping
  # any unrelated tag (e.g. "v1.2.3") that happens to point at HEAD.
  case "$tag" in *@*) ;; *) continue ;; esac
  name="${tag%@*}"
  version="${tag##*@}"
  [ -n "$name" ] && [ -n "$version" ] || continue

  # Resolve the package before touching the remote so an unrelated tag that
  # happens to point at HEAD (e.g. "deploy@prod") is never pushed.
  if ! dir="$(pkg_dir_for "$name")"; then
    echo "No package directory matches ${name}; skipping ${tag}"
    continue
  fi

  if ! git ls-remote --exit-code --tags origin "refs/tags/${tag}" >/dev/null 2>&1; then
    echo "Pushing tag ${tag}"
    git push origin "refs/tags/${tag}"
  fi

  if gh release view "$tag" >/dev/null 2>&1; then
    continue
  fi

  prerelease=()
  case "$version" in *-*) prerelease=(--prerelease) ;; esac

  echo "Creating GitHub release ${tag}"
  # A version heading may exist with an empty body (e.g. packages with no
  # direct changes), which is a valid empty release. Only fall back to
  # auto-generated notes when the heading is missing entirely.
  if grep -qxF "## ${version}" "${dir}/CHANGELOG.md" 2>/dev/null; then
    notes_file="$(mktemp)"
    changelog_entry "${dir}/CHANGELOG.md" "$version" >"$notes_file"
    gh release create "$tag" --title "$tag" --notes-file "$notes_file" "${prerelease[@]}"
    rm -f "$notes_file"
    notes_file=""
  else
    echo "No changelog entry for ${tag}; generating release notes"
    gh release create "$tag" --title "$tag" --generate-notes "${prerelease[@]}"
  fi
done
