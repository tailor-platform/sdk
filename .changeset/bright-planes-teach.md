---
"@tailor-platform/sdk": minor
---

Add OpenTelemetry tracing to CLI apply process for performance profiling

- Implement opt-in OTLP tracing activated via `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable
- Use `@opentelemetry/api` built-in noop spans for zero overhead when tracing is disabled
- Instrument all apply phases (build, plan, confirm, create/update, delete) with hierarchical spans
- Add Connect-RPC interceptor for automatic RPC call tracing
- Parallelize plan phase service calls and internal RPC calls for ~60% faster plan execution
- Fix race condition in parallel plan phase with Promise-based memoization for loadTypes/loadExecutors
