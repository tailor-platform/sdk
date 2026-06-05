---
"@tailor-platform/sdk": patch
---

Validate auth service configuration during `deploy` / `generate`, consistent with how IdP, TailorDB, and static websites are already handled. Configs that set both `userProfile` and `machineUserAttributes` now fail with a clearer message: "Specify either `userProfile` or `machineUserAttributes`, not both."
