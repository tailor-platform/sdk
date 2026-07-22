---
"@tailor-platform/sdk": patch
---

Fix `deploy --dry-run` reporting phantom TailorDB type updates right after a deploy that ran migrations. Committed migration snapshots can record the same permission policies in a different array order than the current config parse, and migration replay re-applies that order; since the platform evaluates policies order-insensitively, the deploy diff now compares each action's permission policies as a set instead of an ordered list.
