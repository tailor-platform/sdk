---
"@tailor-platform/sdk": patch
---

`tailor deploy` and `tailor tailordb migration test` now save the selected workspace inside an absolute `TAILOR_BUILD_OUTPUT_DIR` instead of recreating that path under the config file's directory. Config files in different directories that share a build output directory outside their own directory keep separate selections. A selection saved by an earlier version in either setup is not reused, so the next deploy without `--workspace-id` selects a workspace as on a first deploy; a non-interactive run stops with `WORKSPACE_SELECTION_REQUIRED` until you pass `--workspace-id` once. You can delete the directory that earlier versions created under the config file's directory.
