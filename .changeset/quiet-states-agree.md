---
"@tailor-platform/sdk": patch
---

`tailor tailordb migration status` now reports an error for a namespace whose remote checkpoint is ahead of the latest local migration, for example `0009` on the workspace while the local history ends at `0002`. It used to show that namespace as up to date with no pending migrations. With `maintenanceMode` on, `tailor deploy` also records the maintenance mode with every migration checkpoint of a namespace instead of only the last one, so a deploy that stops after the first of several migrations leaves the record that `tailor tailordb migration resolve` and the next deploy use to lift the maintenance mode.
