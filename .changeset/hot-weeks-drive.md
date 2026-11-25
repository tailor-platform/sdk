---
"@tailor-platform/sdk": patch
---

When `TAILOR_BUILD_OUTPUT_DIR` is an absolute path or points outside the config file's directory (such as `../out`), `tailor deploy` and `tailor tailordb migration test` now save the selected workspace in that directory under a name unique to each config file. Previously an absolute path was recreated under the config file's directory, and config files in different directories that shared `../out` read each other's selection. A selection that an earlier version saved in these setups is not reused: the next deploy that does not name a workspace (`--workspace-id`, `TAILOR_PLATFORM_WORKSPACE_ID`, or a profile) selects one as on a first deploy, and a non-interactive run stops with `WORKSPACE_SELECTION_REQUIRED` until one run names it. For an absolute path, you can delete the copy of that path that earlier versions created under the config file's directory (for example `tmp/tailor-out/` for `/tmp/tailor-out`).
