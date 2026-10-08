---
"@tailor-platform/sdk": minor
---

`tailor tailordb migration test` now accepts `--organization-id` and `--folder-id` to choose where the temporary workspace is created. With only `--organization-id` it is created at that organization's root; with `--folder-id` it is created in that folder, and the command fails before creating anything if the folder does not belong to the organization. Without either option it still follows the source workspace's organization and folder. Both options are rejected together with `--target-workspace-id`.
