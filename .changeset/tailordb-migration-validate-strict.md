---
"@tailor-platform/sdk": minor
---

Add `--strict` to `tailordb migration validate`: validation additionally fails when a migration not yet applied to the remote has data-loss warnings (e.g. a removed field or type) but neither a `migrate.ts` nor a recorded `--no-script` acknowledgment. The failure names the affected type and field and prints the exact command to record the acknowledgment, so CI can require destructive changes to be explicitly acknowledged before merge.

To support this, `tailordb migration script <number> --no-script --reason "..."` now accepts warning-tier migrations (previously it was rejected unless the migration required a script), and `migration generate` offers to record the reason interactively when it detects warnings. Additionally, running `migration script <number>` when `migrate.ts` already exists now clears a stale `--no-script` acknowledgment from `diff.json` instead of failing, resolving the previously unclearable state after hand-adding a script.
