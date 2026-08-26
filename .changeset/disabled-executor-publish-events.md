---
"@tailor-platform/sdk": patch
---

Stop counting an executor declared with `disabled: true` as a subscriber when `deploy` resolves `publishEvents`. Such an executor never runs, so it no longer keeps event publishing enabled on the TailorDB table, resolver, IdP, or workflow its trigger names, and no longer rejects an explicit `publishEvents: false` on that resource.
