#!/bin/bash
# These options ensure the script fails when diagnostics encounter errors.
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "Running full project type check performance measurement..."

# Generate types first
echo "Generating types..."
pnpm generate

# Run type check with diagnostics and process results
echo "Running TypeScript compiler with diagnostics..."
pnpm exec tsc --noEmit --diagnostics 2>&1 | \
  BENCHMARK_TS_IMPL_LABEL=full tsx scripts/perf/process-results.ts > diagnostics-full.json

echo "Results written to diagnostics-full.json"
cat diagnostics-full.json
