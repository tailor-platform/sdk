#!/usr/bin/env bash
# Resolves `prereleaseUntil: V2_NEXT_PENDING` codemod boundaries (see
# packages/sdk-codemod/src/registry.ts) against the version the release PR
# just bumped `@tailor-platform/sdk` to. A codemod's exact `2.0.0-next.N`
# boundary is only known once changesets/action resolves the real next
# version here, so codemods added while that version is still unknown are
# registered against the V2_NEXT_PENDING sentinel and fixed up in this step.
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
trap 'git checkout --quiet "$original_ref"' EXIT

PR_BRANCH="$(gh pr view "$PR_NUMBER" --json headRefName -q .headRefName)"
gh pr checkout "$PR_NUMBER"

pnpm codemod:resolve-pending

registry_path="packages/sdk-codemod/src/registry.ts"
if git diff --quiet -- "$registry_path"; then
  exit 0
fi

pnpm exec oxfmt --write "$registry_path"

content_b64="$(base64 -w0 "$registry_path")"
sha="$(gh api "repos/${GITHUB_REPOSITORY}/contents/${registry_path}?ref=${PR_BRANCH}" -q .sha)"

gh api "repos/${GITHUB_REPOSITORY}/contents/${registry_path}" \
  -X PUT \
  -f message="chore(codemod): resolve pending prerelease boundary" \
  -f content="${content_b64}" \
  -f sha="${sha}" \
  -f branch="${PR_BRANCH}"

echo "Resolved pending codemod boundaries on ${PR_BRANCH}."
