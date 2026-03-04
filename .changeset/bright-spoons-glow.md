---
"@tailor-platform/sdk": minor
---

Add OpenTelemetry tracing instrumentation to the generate command. Each phase (loadTypes, loadResolvers, loadExecutors, generators) is measured as a span, opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT` with zero overhead when disabled. Refactor generator scheduling to align with the plugin hook model — generators are now called at each phase they subscribe to via their dependencies array, matching how plugins use onTailorDBReady/onResolverReady/onExecutorReady hooks.
