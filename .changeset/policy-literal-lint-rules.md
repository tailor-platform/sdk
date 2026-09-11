---
"@tailor-platform/eslint-plugin-sdk": minor
"@tailor-platform/create-sdk": minor
---

Add three lint rules that check literal values against constraints the build otherwise validates only at `tailor generate` / `tailor deploy` time: `valid-execution-policy-definition` (a workflow execution policy `name` or `key` outside the platform grammar), `valid-workflow-retry-policy` (a `retryPolicy` outside the platform limits, such as `initialBackoff` greater than `maxBackoff`), and `valid-resolver-permission` (a permission with no `permit: true` policy, or a condition that does not compare exactly one `user` operand to a string or a boolean). Values the rules cannot resolve to literals are left to the build. Enabled in newly scaffolded projects.
