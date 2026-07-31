---
"@tailor-platform/sdk": patch
---

Skip caching a bundle instead of failing the build when a dependency file cannot be hashed for a reason other than being missing (e.g. a permission error). Bundle cache restoration already tolerated this; saving a new cache entry now does too.
