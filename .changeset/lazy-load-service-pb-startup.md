---
"@tailor-platform/sdk": patch
---

The `@tailor-proto/tailor/v1/service_pb` module is now loaded lazily inside `initOperatorClient()` rather than at module startup. Commands that do not connect to the platform (`profile list`, `profile delete`, `login`, `logout`) no longer pay the ~4.6s protobuf descriptor initialization cost on every invocation.
