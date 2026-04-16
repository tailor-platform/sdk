---
"@tailor-platform/sdk": minor
---

Add `--order` and `--limit` options to CLI list commands for consistent pagination. Time-series log commands (`function logs`, `workflow executions`, `executor jobs`) now default to newest-first (`--order desc`) and the most recent 50 items (`--limit 50`); pass `--order asc` or `--limit 0` to opt out. Other list commands (`workflow list`, `executor list`, `staticwebsite list`, `oauth2client list`, `secret list`, `secret vault list`, `user pat list`, `machineuser list`, `authconnection list`) gain optional `--order`/`--limit` that leave server-side defaults untouched when omitted, so existing invocations behave identically.
