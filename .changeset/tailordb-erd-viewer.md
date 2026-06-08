---
"@tailor-platform/sdk": minor
---

Replace the Liam-based `tailordb erd` beta commands with a TailorDB-specific ERD viewer generated from local TailorDB schema. `tailordb erd export` now writes a static viewer under `<output>/<namespace>/dist` (or a single self-contained `index.html` with `--inline`), `tailordb erd serve` runs a built-in local server with watch reload and `--port` / `--open`, and `tailordb erd deploy` uploads the generated viewer while keeping the existing `erdSite` requirement.
