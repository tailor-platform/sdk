---
"@tailor-platform/sdk": patch
---

Report the checkpoint reset that the next deploy makes in `tailor tailordb migration status`, instead of a migration history mismatch, for a workspace still at the checkpoint and migration history that `migration rebaseline` replaced. The command now exits zero in that case, lists the migrations after `0000` as pending, and reports the reset as `checkpointRepair` in `--json` output.
