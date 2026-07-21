---
"@tailor-platform/sdk": minor
---

Add a `logger` API for structured logging from Tailor Platform functions, exposing `debug`, `info`, `warn`, `error`, and `setAttributes`. The message is written to standard output, and the full entry with its attributes is exported over OpenTelemetry, where the attributes are queryable. Attribute values are typed to what OpenTelemetry can carry (`string`, `number`, `boolean`, and homogeneous arrays of those).
