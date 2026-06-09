---
"@tailor-platform/sdk": minor
---

Replace the Liam-based `tailordb erd` beta commands with a TailorDB-specific ERD viewer generated from local TailorDB schema. `tailordb erd export` writes a single self-contained `index.html` under `<output>/<namespace>/dist` (CSS, JS, and the schema are inlined as separately extractable blocks), `tailordb erd serve` runs a built-in local server with watch reload and `--port` / `--open`, and `tailordb erd deploy` uploads the generated viewer while keeping the existing `erdSite` requirement.
