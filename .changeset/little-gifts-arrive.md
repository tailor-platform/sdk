---
"@tailor-platform/sdk": minor
---

group related resource changes in apply dry-run output

Consolidate function registry changes with their parent resources (workflow, resolver, executor, auth hook) in dry-run display. Also group TailorDB type and gqlPermission changes by type name.

This makes the output easier to understand by showing related changes together (e.g., "workflow (workflow, functionRegistry)") instead of listing them separately. Plan summary counts now reflect grouped units to match the displayed rows.
