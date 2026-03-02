---
"@tailor-platform/sdk": minor
---

Add OpenTelemetry tracing instrumentation to the generate command. Each phase (loadTypes, loadResolvers, loadExecutors, generators) is measured as a span, opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT` with zero overhead when disabled. Also refactor generator scheduling to use a dependency-resolution model instead of hardcoded category filters.
