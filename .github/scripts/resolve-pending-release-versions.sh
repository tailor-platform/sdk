#!/usr/bin/env bash
# Resolves the version placeholders that can only be filled in once
# changesets/action has decided the next release version, against the version
# the release PR just bumped `@tailor-platform/sdk` to:
#
#   - `prereleaseUntil: V2_NEXT_PENDING` codemod boundaries
#     (packages/sdk-codemod/src/registry.ts)
#   - `@deprecated since NEXT_RELEASE` markers (packages/sdk/src/**)
#
# Both describe the version a change ships in, which is unknown while the
# change is being written, so they are authored against a sentinel and fixed
# up here. See .agents/rules/deprecation.md.
#
# Pushes the fixup straight to the release PR branch through the GitHub
# Contents API (like ensure-github-releases.sh) rather than a local git
# commit/push, since this token has no configured git identity or signing key.
#
# `gh pr checkout` moves the working tree onto the release PR branch, but the
# steps after this one (notably ensure-github-releases.sh) assume HEAD is
# still the commit that triggered the workflow. Restore it on every exit path
# so an unpublished release-PR commit is never mistaken for that trigger.
set -euo pipefail

original_ref="$(git rev-parse HEAD)"
# --hard: the resolvers and oxfmt below leave tracked files modified, and a
# plain `git checkout` refuses to switch away from a dirty tracked file.
trap 'git reset --hard --quiet "$original_ref"' EXIT

# changesets/action applies `changeset version`'s file
# edits (package.json bumps, CHANGELOG.md, consumed .changeset/*.md deletions)
# straight to this worktree and pushes them to the release PR branch through the
# API, but never commits them locally — leaving this checkout dirty. Without
# these, `gh pr checkout` below fails with "local changes would be overwritten"
# on every run that actually creates or updates a release PR. `clean` covers
# untracked files those edits create (a first-release package's CHANGELOG.md),
# which the release PR branch tracks and `reset --hard` leaves behind.
git reset --hard --quiet
git clean -fdq

PR_BRANCH="$(gh pr view "$PR_NUMBER" --json headRefName -q .headRefName)"
gh pr checkout "$PR_NUMBER"
# Detach so the trap's reset only moves HEAD, not the local branch gh pr checkout made.
git checkout --quiet --detach

pnpm codemod:resolve-pending
pnpm deprecations:resolve-pending

mapfile -t resolved_paths < <(git diff --name-only)
if [ "${#resolved_paths[@]}" -eq 0 ]; then
  exit 0
fi

pnpm exec oxfmt --write "${resolved_paths[@]}"

# One Contents API call per file: each creates its own commit on the release PR
# branch, and the blob sha is re-read per file so a preceding push in this loop
# does not invalidate the next one.
for path in "${resolved_paths[@]}"; do
  content_b64="$(base64 <"$path" | tr -d '\n')"
  sha="$(gh api "repos/${GITHUB_REPOSITORY}/contents/${path}?ref=${PR_BRANCH}" -q .sha)"

  gh api "repos/${GITHUB_REPOSITORY}/contents/${path}" \
    -X PUT \
    -f message="chore: resolve pending release version in ${path}" \
    -f content="${content_b64}" \
    -f sha="${sha}" \
    -f branch="${PR_BRANCH}"
done

echo "Resolved ${#resolved_paths[@]} pending version placeholder(s) on ${PR_BRANCH}."
