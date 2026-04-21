---
"@tailor-platform/sdk": patch
---

fix(workflow): reject top-level `null` in `createWorkflowJob` input type

The platform normalizes top-level `null`/`undefined` args to `{}` per the value normalization spec, so declaring a job body with `input: null` (or a top-level union containing `null`) would cause the body to receive `{}` at runtime, mismatching the declared type. `IsValidInput` now rejects top-level `null`; nested `null` inside objects or arrays is still allowed.
