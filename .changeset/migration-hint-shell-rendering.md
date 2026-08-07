---
"@tailor-platform/sdk": patch
---

Copyable migration-script hint commands — from `migration generate`, `migration validate --strict`, and deploy's missing-script error — are now rendered by one shell-aware formatter. Values are quoted for the platform shell, and on Windows a value containing `%`, `$`, or `!` (which cmd.exe/PowerShell expand even inside double quotes) switches the hint to an argv rendering instead of a command line that would resolve to a different path. The deploy hint now also pads the migration number, binds `--config` with the `=` form, and omits it for the default config path.
