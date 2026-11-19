---
"@tailor-platform/sdk": minor
---

**Breaking change**: In non-interactive or JSON mode, `tailor deploy` (and the `deploy()` / `apply()` exports of `@tailor-platform/sdk/cli`) no longer picks the only workspace visible to the account on its own, so a first deploy from a fresh clone, CI, or an AI agent cannot land in another project's workspace. When no workspace comes from `--workspace-id`, `TAILOR_PLATFORM_WORKSPACE_ID`, the profile, or a saved selection, it now stops with `WORKSPACE_SELECTION_REQUIRED`. Pass `--workspace-id` or set `TAILOR_PLATFORM_WORKSPACE_ID` to keep such runs working. Interactive terminals, `--create-workspace` reruns, and saved selections are unchanged.
