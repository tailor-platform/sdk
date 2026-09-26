---
"@tailor-platform/sdk": patch
---

On Windows, a suggested follow-up command whose arguments cmd.exe and PowerShell read differently (for example a profile named `dev$1`, a config path containing `%`, or the webhook trigger's JSON body) is now shown as one command to copy into PowerShell and one to copy into cmd.exe, instead of an `argv [...]` array or a double-quoted line that PowerShell misreads. The `tailor profile update` suggestions shown for a read-only profile or a denied machine-user override now quote the profile name instead of pasting it into the command unquoted.
