---
"@tailor-platform/sdk": minor
---

`tailor tailordb migration test` now accepts `--organization-id` and `--folder-id` to choose where the temporary workspace is created. With only `--organization-id` it is created at that organization's root; with `--folder-id` it is created in that folder, and the command fails before creating anything if the folder is not found in the organization (`--folder-id` alone also fails when the source workspace is not in an organization, so pass `--organization-id` with it). Without either option it still follows the source workspace's organization and folder. With `--target-workspace-id`, the given organization and folder must match the ones the target workspace is already in; otherwise the command fails and names the mismatch.
