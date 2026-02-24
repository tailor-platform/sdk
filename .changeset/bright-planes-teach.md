---
"@tailor-platform/sdk": minor
---

Add OpenTelemetry tracing to CLI apply process for performance profiling

- Implement opt-in OTLP tracing activated via `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable
- Add `withSpan()` helper with zero overhead when tracing is disabled (dynamic imports only when enabled)
- Instrument all apply phases (build, plan, confirm, create/update, delete) with hierarchical spans
- Add Connect-RPC interceptor for automatic RPC call tracing
- Parallelize plan phase service calls and internal RPC calls for ~60% faster plan execution
