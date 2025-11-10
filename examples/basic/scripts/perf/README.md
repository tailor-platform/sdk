# Type Check Performance Measurement

This directory contains tools for measuring TypeScript type checking performance of the Tailor Platform SDK.

Inspired by the Hono project implementation, this performs two types of measurements:

1. **Full Project Check**: Type checking time for the entire `examples/basic` project
2. **Type Inference Checks**: Complexity and scalability of type inference measured separately for each service:
   - **TailorDB**: 100 models
   - **Pipeline**: 200 resolvers
   - **Executor**: 100 executors

## Local Execution

Run from the project root directory:

```bash
# Run both measurements
pnpm perf:typecheck

# Full project check only
pnpm --filter @examples/basic perf:typecheck:full

# Type inference check only
pnpm --filter @examples/basic perf:typecheck:inference
```

Or run directly within the examples/basic directory:

```bash
cd examples/basic

# Both measurements
pnpm perf:typecheck

# Individual execution
bash scripts/perf/run-typecheck-full.sh
bash scripts/perf/run-typecheck-inference.sh
```

## Results

Measurement results are output to the following files:

- `diagnostics-full.json`: Full project check results
- `diagnostics-models.json`: TailorDB models inference results
- `diagnostics-resolvers.json`: Pipeline resolvers inference results
- `diagnostics-executors.json`: Executors inference results

### Metrics

Each file contains the following metrics:

- **files**: Number of files type-checked
- **lines**: Number of lines processed
- **identifiers**: Number of identifiers
- **symbols**: Number of symbols
- **types**: Number of types
- **instantiations**: Number of type instantiations
- **memory-used**: Memory usage (KB)
- **i-o-read**: I/O read time (seconds)
- **i-o-write**: I/O write time (seconds)
- **parse-time**: Parse time (seconds)
- **bind-time**: Bind time (seconds)
- **check-time**: Check time (seconds)
- **emit-time**: Emit time (seconds)
- **total-time**: Total time (seconds)

### Example Measurements

**Full Project Check**:

- Files: 944
- Types: 121,971
- Instantiations: 563,547
- Memory: 812MB
- Total Time: 8.56s

**Type Inference Checks**:

_TailorDB Models_:

- Total Time: 0.68s

_Pipeline Resolvers_:

- Total Time: 1.17s

_Executors_:

- Total Time: 27.89s

## CI Execution

The GitHub Actions workflow `.github/workflows/type-check-performance.yml` runs automatically on:

- Pull request creation
- Push to main branch
- Manual execution (workflow_dispatch)

Using **octocov**, it compares against past measurements and automatically detects performance degradation. PR comments display:

- Comparison of current and previous values for each metric
- Rate of change (percentage increase/decrease)
- Performance degradation warnings

## Implementation Details

### Scripts

- **`run-typecheck-full.sh`**: Executes type checking for the entire project
  - Generates types with `pnpm generate`
  - Collects diagnostics with TypeScript compiler
  - Pipes to `process-results.ts` for processing

- **`run-typecheck-inference.sh`**: Measures type inference scalability for each service
  - Generates TailorDB models, resolvers, and executors with `generate.ts`
  - Tests type inference separately for:
    - TailorDB models using `client-models.ts` and `tsconfig.models.json`
    - Pipeline resolvers using `client-resolvers.ts` and `tsconfig.resolvers.json`
    - Executors using `client-executors.ts` and `tsconfig.executors.json`

- **`generate.ts`**: Script to generate performance test code
  - Generates 100 TailorDB models
  - Generates 200 resolvers
  - Generates 100 executors
  - Outputs to `generated-perf/` directory

- **`process-results.ts`**: Converts TypeScript diagnostics output to octocov-compatible JSON format
  - Reads diagnostics from stdin
  - Converts keys to kebab-case
  - Outputs metrics in array format

- **`client-models.ts`**: Client to test TailorDB models type inference only
- **`client-resolvers.ts`**: Client to test Pipeline resolvers type inference only
- **`client-executors.ts`**: Client to test Executors type inference only

### Configuration Files

- **`tsconfig.models.json`**: TypeScript configuration for TailorDB models measurement
  - Includes only `client-models.ts`
- **`tsconfig.resolvers.json`**: TypeScript configuration for Pipeline resolvers measurement
  - Includes only `client-resolvers.ts`
- **`tsconfig.executors.json`**: TypeScript configuration for Executors measurement
  - Includes only `client-executors.ts`
- All configurations use `skipLibCheck: true` for faster execution

- **`.octocov.perf.yml`**: octocov configuration
  - Defines 4 custom metrics (full, models, resolvers, executors)
  - Configures PR comments and summary

## Reference

This implementation is inspired by the `perf-measures/type-check` in [honojs/hono](https://github.com/honojs/hono).
