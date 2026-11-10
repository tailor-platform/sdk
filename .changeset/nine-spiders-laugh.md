---
"@tailor-platform/eslint-plugin-sdk": minor
"@tailor-platform/create-sdk": minor
"@tailor-platform/sdk": patch
---

Add the `no-unused-resolver-input` lint rule, which reports a resolver `input` field that `body` never reads, since a caller may expect it to take effect. A field that `permission` compares with the caller or that declares a `validate` counts as used, and a resolver whose `body` passes its input on in a way that hides which fields it reads is not reported. Silence a field kept on purpose with `eslint-disable-next-line`. Enabled in the ESLint `recommended` config and in newly scaffolded projects; existing Oxlint projects add `"tailor-sdk/no-unused-resolver-input": "warn"` to `.oxlintrc.json`.
