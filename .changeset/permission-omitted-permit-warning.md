---
"@tailor-platform/sdk": patch
---

Warn when a permission rule is written in object form without an explicit `permit`. Object-format rules (e.g. `read: [{ conditions: [...] }]`) default to `deny`, unlike the array shorthand which defaults to `allow`, so omitting `permit` can silently lock out access you meant to grant. The CLI now flags these rules during generate/deploy so you can set `permit: true` (allow) or `permit: false` (deny) explicitly. Runtime behavior is unchanged. This covers TailorDB record permissions, TailorDB GraphQL permissions, and IdP permissions.
