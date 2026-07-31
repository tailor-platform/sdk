---
"@tailor-platform/sdk-codemod": patch
---

Add a `V2_NEXT_PENDING` placeholder `prereleaseUntil` for codemods whose exact `2.0.0-next.N` release boundary isn't known yet at implementation time, plus a `pnpm codemod:resolve-pending` step (wired into the release workflow) that resolves it to the real version constant once the release PR bumps `@tailor-platform/sdk`'s version. Prevents codemod boundaries from drifting out of sync with the version they actually ship in, which previously required a manual follow-up fix after each release.
