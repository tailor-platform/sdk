---
"@tailor-platform/sdk": patch
---

Fix `tailor deploy` to show the "run `tailor tailordb migration generate`" hint when a field changes from optional to required and existing records still have null values. The hint's error-message match never matched the platform's actual wording ("records with null values exist" vs. the expected "records exist"), so the hint never appeared and the schema-change failure surfaced with no guidance.
