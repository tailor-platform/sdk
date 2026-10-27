---
"@tailor-platform/sdk": patch
---

`tailor remove` now deletes every resource it lists. Before, when the only remaining resources were sub-resources such as TailorDB types, resolvers, IdP clients, auth configs, or auth connections, it listed them without deleting them. It now also lists workflow job functions; before, they were deleted without being listed, and when nothing else remained they were not deleted at all. Deploy plans, including the `Plan:` summary counts and `--dry-run --json` `changes`, now list each workflow job function deletion as its own `jobFunction` entry, so removing a workflow shows and counts its job functions on separate lines.
