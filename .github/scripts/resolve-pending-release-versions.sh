#!/usr/bin/env bash
# Resolves the version placeholders that can only be filled in once
# changesets/action has decided the next release version, against the version
# the release PR just bumped `@tailor-platform/sdk` to:
#
#   - `prereleaseUntil: V2_NEXT_PENDING` and `until: NEXT_RELEASE` codemod
#     boundaries (packages/sdk-codemod/src/registry.ts)
#   - `@deprecated since NEXT_RELEASE` markers (packages/sdk/src/**)
#   - a pending `TEMPLATE_CHANGED_SINCE_RELEASE` in
#     packages/sdk-plugin-setup/src/templates.ts, released as the next
#     `RELEASED_TEMPLATE_VERSION` with its template fingerprint
#
# All describe the version a change ships in, which is unknown while the
# change is being written, so they are authored against a sentinel and fixed
# up here. See docs/deprecation.md.
#
# Pushes the fixup straight to the release PR branch through the GitHub
# GraphQL API rather than a local git commit/push, since this token has no
# configured git identity or signing key.
#
# Restore the base checkout without moving either local branch on exit.
set -euo pipefail

original_ref="$(git rev-parse HEAD)"
node .github/scripts/release-state.mjs assert "$original_ref"
trap 'git checkout --quiet --detach --force "$original_ref"' EXIT

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
git checkout --quiet --detach
release_head="$(git rev-parse HEAD)"
git merge-base --is-ancestor "$original_ref" "$release_head"

PREVIOUS_SDK_VERSION="$(git show "${original_ref}:packages/sdk/package.json" | jq -r .version)" \
  pnpm codemod:resolve-pending
pnpm deprecations:resolve-pending
pnpm setup:template-version:resolve-pending

mapfile -t resolved_paths < <(git diff --name-only)
if [ "${#resolved_paths[@]}" -eq 0 ]; then
  exit 0
fi

pnpm exec oxfmt --write "${resolved_paths[@]}"

node .github/scripts/release-state.mjs commit "$original_ref" "$PR_BRANCH" "$release_head"
