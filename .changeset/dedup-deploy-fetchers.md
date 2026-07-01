---
"@tailor-platform/sdk": patch
---

Internal refactoring: deduplicate existing-resource fetching in the deploy command by reusing the shared `fetchExistingResourcesWithLabels` helper across auth, IdP, resolver, secret manager, function registry, and TailorDB planning. No user-facing behavior change.
