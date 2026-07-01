---
"@tailor-platform/sdk": minor
---

Add `tailor-install`, `tailor-notify`, and `tailor-drift-check` steps to generated branch/tag workflow templates. Generated workflows now pin to a SHA-addressed version of `tailor-platform/actions`.

Add `setup check --ci` flag: WORKSPACE_ID check is skipped in CI (handled by the runtime) and enforced only in local environments.

Add `setup check` Slack partial-config detection: errors when exactly one of `TAILOR_SLACK_BOT_TOKEN` / `TAILOR_SLACK_CHANNEL_ID` is set.

Add drift checks: `migration-drift`, `seed-validate`, and `static-websites` rules detect when config changes require re-running setup. Slack partial-config (exactly one of `TAILOR_SLACK_BOT_TOKEN` / `TAILOR_SLACK_CHANNEL_ID` set) is a preflight error, not a drift finding.

Add `setup action` subcommand: generates a per-app composite action under `.github/actions/tailor-<name>/action.yml` that wraps `tailor-platform/actions/deploy`. Includes `user-mapping` input for Slack notifications and an optional `build-site` user-owned slot for static website asset builds.

Add `setup coordinate` subcommand: generates a coordinator workflow that orchestrates multiple per-app composite actions in a single branch or tag deploy pipeline.

**Breaking change (beta)**: Tag workflow files are now named `tailor-<name>-tag.yml` instead of `tailor-<name>.yml`. Re-run `tailor-sdk setup tag` to generate the new file, then manually delete the old `tailor-<name>.yml` workflow.
