---
"@tailor-platform/sdk": minor
---

Add `--order` and `--limit` options to CLI list commands for consistent pagination. Time-series log commands (`function logs`, `workflow executions`, `executor jobs`) default to newest-first (`--order desc`) and the most recent 50 items (`--limit 50`); pass `--order asc` or `--limit 0` to opt out. Other list commands (`workflow list`, `executor list`, `staticwebsite list`, `oauth2client list`, `secret list`, `secret vault list`, `user pat list`, `machineuser list`, `authconnection list`) also default to `--order desc` and accept `--limit N` (unlimited when omitted or set to `0`); pass `--order asc` to restore ascending order.
