---
"@tailor-platform/sdk": patch
---

`tailor deploy` and `tailor remove` now also stop with `SERVICE_IN_USE` before they change anything when they would delete a Secret Manager secret, or the vault that holds it, that an OTLP exporter authenticates with. Before, they deleted it without reporting that it was still in use, which left the exporter naming a secret that no longer exists. The SDK does not deploy OTLP exporters, so change or delete the exporter outside the SDK, then run the command again. In the error's `context.uses`, these entries carry `usedBy` `telemetryrouter.otlp_exporter` and no `application`, and when every listed user has no application, the `remove` suggestion no longer asks you to remove applications.
