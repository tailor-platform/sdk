---
"@tailor-platform/eslint-plugin-sdk": minor
"@tailor-platform/create-sdk": minor
"@tailor-platform/sdk": patch
---

Add the `no-unbound-caller-id-input` lint rule, which reports a resolver mutation's `t.uuid()` or `db.uuid()` input named like the caller's ID, such as `approverId`, `requesterId`, or `createdBy`, unless every `permit: true` policy of its `permission` compares the input with the caller; otherwise a caller can act as another user by sending that user's ID. Enabled in newly scaffolded projects and in the ESLint `recommended` config; add `"tailor-sdk/no-unbound-caller-id-input": "warn"` to the `rules` of an existing `.oxlintrc.json` to enable it there.
