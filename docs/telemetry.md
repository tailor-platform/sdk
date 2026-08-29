# Telemetry / Performance Profiling

## Overview

The SDK CLI has built-in OpenTelemetry (OTLP) tracing for performance analysis. It is **opt-in** — tracing activates only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. When disabled, there is zero overhead (no OpenTelemetry packages are loaded).

All CLI commands instrumented with `withSpan()` emit trace data that can be visualized in any OTLP-compatible backend (Jaeger, Grafana Tempo, Datadog, etc.).

## Environment Variables

| Variable                      | Description                                                                                | Default                      |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint (e.g., `http://localhost:4318`). **Setting this enables tracing.** | _(unset — tracing disabled)_ |

## Quick Start

### 1. Start Jaeger

```bash
docker run -d --name jaeger-otlp \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

### 2. Run a command with tracing

```bash
cd example
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm tailor deploy --dry-run
```

### 3. View traces

Open http://localhost:16686, select service **tailor**, and click **Find Traces**.

## Span Hierarchy

The `deploy` command emits the following span tree:

```
deploy
├── config.preflight
├── build
│   ├── build.loadConfig
│   ├── build.generateUserTypes
│   └── build.loadApplication
├── plan.metadataLookup
├── plan.validateTailorDBTypeNames
├── plan.detectSdkVersionChange
├── plan
│   ├── plan.functionRegistry
│   ├── plan.tailorDB
│   ├── plan.staticWebsite
│   ├── plan.aiGateway
│   ├── plan.idp
│   ├── plan.auth
│   ├── plan.pipeline
│   ├── plan.application
│   ├── plan.executor
│   ├── plan.workflow
│   ├── plan.workflowExecutionPolicy
│   └── plan.secretManager
├── confirm
├── apply.preflight
├── apply.createUpdateServices
│   ├── apply.secretManager.createUpdate
│   ├── apply.functionRegistry.createUpdate
│   ├── apply.staticWebsite.createUpdate
│   ├── apply.aiGateway.createUpdate
│   ├── apply.idp.createUpdate
│   ├── apply.auth.createUpdatePrerequisites
│   ├── apply.tailorDB.createUpdate
│   │   ├── apply.tailorDB.migration.prePhase
│   │   ├── apply.tailorDB.migration.script
│   │   └── apply.tailorDB.migration.postPhase
│   ├── apply.auth.createUpdateDependents
│   └── apply.pipeline.createUpdate
├── apply.deleteSubgraphResources
├── apply.createUpdateApplication
├── apply.createUpdateDependentServices
│   ├── apply.executor.createUpdate
│   ├── apply.workflowExecutionPolicy.createUpdate
│   └── apply.workflow.createUpdate
├── apply.deleteDependentServices
├── apply.deleteApplication
├── apply.deleteSubgraphServices
└── apply.cleanup
```

The pre/post migration spans repeat once per pending migration; the script span
appears only for migrations that carry a `migrate.ts`.

Individual RPC calls are also traced as `rpc.*` child spans (e.g., `rpc.CreateApplication`) via the Connect-RPC interceptor.

## Analyzing Traces via API

### List spans sorted by duration

```bash
curl -s "http://localhost:16686/api/traces?service=tailor&limit=1" | jq '
  .data[0].spans[]
  | {operationName, duration_ms: (.duration / 1000 | . * 100 | round / 100)}
' | jq -s 'sort_by(-.duration_ms)'
```

### Show span hierarchy with parent info

```bash
curl -s "http://localhost:16686/api/traces?service=tailor&limit=1" | jq '
  .data[0] as $trace |
  $trace.spans | map({
    operationName,
    duration_ms: (.duration / 1000 | . * 100 | round / 100),
    parentSpanID: (.references[]? | select(.refType == "CHILD_OF") | .spanID) // "root"
  }) | sort_by(-.duration_ms)
'
```

### Compare two traces (before/after)

```bash
curl -s "http://localhost:16686/api/traces?service=tailor&limit=2" | jq '
  [.data[] | {
    traceID: .traceID,
    spans: [.spans[]
      | select(.operationName == "deploy" or .operationName == "plan" or .operationName == "build")
      | {operationName, duration_ms: (.duration / 1000 | . * 100 | round / 100)}
    ]
  }]
'
```

### Measuring the schema/executor window

A deploy applies TailorDB schema changes before it updates executors, so an
executor registered by the previous deploy can fire against a table whose shape
has already changed. The window opens when `apply.tailorDB.createUpdate` starts
mutating schema and closes when `apply.executor.createUpdate` ends:

```bash
curl -s "http://localhost:16686/api/traces?service=tailor&limit=1" | jq '
  [.data[0].spans[]
   | select(.operationName
            | test("^apply\\.(tailorDB\\.createUpdate|executor\\.createUpdate)$"))]
  | if length == 0 then "no schema/executor spans in this trace"
    else {
      window_ms: (((map(.startTime + .duration) | max) - (map(.startTime) | min)) / 1000),
      spans: (sort_by(.startTime) | map({operationName, duration_ms: (.duration / 1000 | round)}))
    } end
'
```

Migration scripts run user code against live data, so
`apply.tailorDB.migration.script` usually dominates the window and is unbounded
in principle — a large backfill widens it arbitrarily.

## Architecture

| File                                            | Role                                                       |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `packages/sdk/src/cli/telemetry/config.ts`      | Parse `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable   |
| `packages/sdk/src/cli/telemetry/index.ts`       | `initTelemetry()`, `shutdownTelemetry()`, `withSpan()`     |
| `packages/sdk/src/cli/telemetry/interceptor.ts` | Connect-RPC interceptor for automatic RPC tracing          |
| `packages/sdk/src/cli/args.ts`                  | Telemetry lifecycle (init in handler, shutdown in finally) |
| `packages/sdk/src/cli/client.ts`                | Tracing interceptor registration                           |
| `packages/sdk/src/cli/commands/deploy/`         | `withSpan()` instrumentation of deploy phases              |
