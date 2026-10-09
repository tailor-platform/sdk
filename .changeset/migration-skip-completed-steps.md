---
"@tailor-platform/sdk": minor
---

Add `tailor deploy --migration-skip-steps <namespace>/<step>,...` to skip the steps of a multi-step TailorDB migration that already succeeded when a changed step list makes the migration run every step again, and make the warning shown in that case list the steps that already succeeded and say how to skip them. `tailor deploy` and `tailor tailordb migration validate` now reject a step name that does not follow the documented rule (a letter first, then letters, digits, and underscores, up to 64 characters), which a step name containing a comma or slash would otherwise break in `--migration-skip-steps`
