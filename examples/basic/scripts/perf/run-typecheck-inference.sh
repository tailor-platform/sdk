#!/bin/bash
set -e

cd "$(dirname "$0")/../.."

echo "Running type inference performance measurement..."

# Generate code
echo "Generating performance test code..."
tsx scripts/perf/generate.ts

# Run type check for TailorDB types
echo "Running TypeScript compiler for TailorDB types..."
pnpm exec tsc -p scripts/perf/tsconfig.types.json --diagnostics 2>&1 | \
  BENCHMARK_TS_IMPL_LABEL=types tsx scripts/perf/process-results.ts > diagnostics-types.json

# Run type check for Pipeline resolvers
echo "Running TypeScript compiler for Pipeline resolvers..."
pnpm exec tsc -p scripts/perf/tsconfig.resolvers.json --diagnostics 2>&1 | \
  BENCHMARK_TS_IMPL_LABEL=resolvers tsx scripts/perf/process-results.ts > diagnostics-resolvers.json

# Run type check for Executors
echo "Running TypeScript compiler for Executors..."
pnpm exec tsc -p scripts/perf/tsconfig.executors.json --diagnostics 2>&1 | \
  BENCHMARK_TS_IMPL_LABEL=executors tsx scripts/perf/process-results.ts > diagnostics-executors.json

echo ""
echo "Results written:"
echo "  - diagnostics-types.json (TailorDB)"
echo "  - diagnostics-resolvers.json (Pipeline)"
echo "  - diagnostics-executors.json (Executor)"
echo ""
echo "=== TailorDB Types ==="
cat diagnostics-types.json | grep -A 2 "total-time"
echo ""
echo "=== Pipeline Resolvers ==="
cat diagnostics-resolvers.json | grep -A 2 "total-time"
echo ""
echo "=== Executors ==="
cat diagnostics-executors.json | grep -A 2 "total-time"
