---
"@tailor-platform/sdk-codemod": patch
---

Fix `v3/files-ignores-to-negation` reporting configs it can migrate: `files` and `ignores` patterns written as template literals without `${}`, and `db` or `resolver` namespaces with a computed key such as `[sharedDb]`, are now migrated instead of flagged for manual review, and the test-file exclusion is no longer appended again when `files` already writes it as a template literal. Projects created from the hello-world, inventory-management, and multi-application templates no longer get these findings from `tailor upgrade`.
