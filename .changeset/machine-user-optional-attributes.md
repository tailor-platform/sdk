---
"@tailor-platform/sdk": minor
---

Machine user attribute keys now mirror the field's optionality: attributes derived from optional user fields (or optional `machineUserAttributes` fields) can be omitted, and `null`/`undefined` values are treated as "attribute not set" instead of being rejected at deploy time. Attributes derived from required fields remain mandatory, and undeclared attribute keys are still rejected. The generated `AttributeMap` type used to read `user.attributes` in resolvers, executors, and workflows now mirrors this same optionality, so an attribute derived from an optional field is typed as possibly absent instead of always present.
