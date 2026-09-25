# Type Check Performance Measurement

This directory contains tools for measuring TypeScript type checking performance of the Tailor Platform SDK.

Inspired by the Hono project implementation, this performs two types of measurements:

1. **Full Project Check**: Type checking time for the entire example project
2. **Feature-based Tests**: Measures type inference cost per SDK feature to identify which features impact type performance most

## Feature-based Test Categories

Each feature is tested with 10 items to measure relative type inference cost:

### TailorDB Features

| Feature             | Description                                                 |
| ------------------- | ----------------------------------------------------------- |
| `tailordb-basic`    | Basic field types (string, int, bool, uuid, date, datetime) |
| `tailordb-optional` | Optional field modifier                                     |
| `tailordb-relation` | Relation definitions (n-1, 1-n)                             |
| `tailordb-validate` | Field validation rules                                      |
| `tailordb-hooks`    | Field hooks (create, update)                                |
| `tailordb-object`   | Nested object fields                                        |
| `tailordb-enum`     | Enum field types                                            |

### Resolver Features

| Feature           | Description                         |
| ----------------- | ----------------------------------- |
| `resolver-basic`  | Basic input/output definitions      |
| `resolver-nested` | Nested object types in input/output |
| `resolver-array`  | Array types in input/output         |

### Executor Trigger Features

| Feature             | Description                                   |
| ------------------- | --------------------------------------------- |
| `executor-schedule` | Schedule trigger                              |
| `executor-webhook`  | Incoming webhook trigger                      |
| `executor-record`   | Record change triggers (create/update/delete) |
| `executor-resolver` | Resolver executed trigger                     |

### Executor Operation Features

| Feature                       | Description        |
| ----------------------------- | ------------------ |
| `executor-operation-function` | Function operation |
| `executor-operation-gql`      | GraphQL operation  |
| `executor-operation-webhook`  | Webhook operation  |
| `executor-operation-workflow` | Workflow operation |

**Note**: All trigger tests use `graphql` operation to isolate trigger costs. All operation tests use `incomingWebhookTrigger` to isolate operation costs.

## Local Execution

Run from the project root directory:

```bash
# Run both measurements
pnpm perf:typecheck

# Full project check only
pnpm --filter example perf:typecheck:full

# Feature-based tests only
pnpm --filter example perf:typecheck:inference
```

Or run directly within the example directory:

```bash
cd example

# Both measurements
pnpm perf:typecheck

# Individual execution
bash scripts/perf/run-typecheck-full.sh
bash scripts/perf/run-typecheck-inference.sh
```

## Results

Measurement results are output to the following files:

- `diagnostics-full.json`: Full project check results
- `diagnostics-tailordb-*.json`: TailorDB feature results
- `diagnostics-resolver-*.json`: Resolver feature results
- `diagnostics-executor-*.json`: Executor feature results

### Key Metrics

Focus on these metrics for performance evaluation:

| Metric             | Description                   | Priority                                 |
| ------------------ | ----------------------------- | ---------------------------------------- |
| **Instantiations** | Number of type instantiations | HIGH - Main indicator of type complexity |
| **Types**          | Number of types processed     | MEDIUM - Watch for unexpected increases  |
| **Check Time**     | Time spent type-checking      | LOW - Varies by CI runner                |

### Example Results (sorted by instantiations)

| Feature                     | Instantiations | Types |
| --------------------------- | -------------: | ----: |
| resolver-nested             |         26,368 | 3,657 |
| resolver-array              |         17,131 | 3,278 |
| resolver-basic              |          9,707 | 2,384 |
| executor-resolver           |          9,708 | 3,392 |
| executor-record             |          9,541 | 3,869 |
| executor-schedule           |          9,143 | 2,621 |
| tailordb-object             |          8,565 | 2,007 |
| executor-operation-workflow |          7,082 | 2,776 |
| executor-webhook            |          5,738 | 2,025 |
| executor-operation-webhook  |          5,732 | 2,706 |
| executor-operation-function |          5,722 | 2,017 |
| executor-operation-gql      |          5,721 | 2,041 |
| tailordb-relation           |          3,862 | 2,042 |
| tailordb-hooks              |          3,461 | 1,685 |
| tailordb-optional           |          2,893 | 1,440 |
| tailordb-basic              |          2,379 | 1,192 |
| tailordb-enum               |          2,372 | 1,200 |
| tailordb-validate           |          2,356 | 1,242 |

**Key Findings**:

- Resolver nested object types have the highest type inference cost (~26k instantiations for 10 items)
- Among executor triggers (using graphql operation): `resolverExecutedTrigger` and `recordTrigger` are most expensive
- Among executor operations (using incomingWebhookTrigger): `workflow` operation is slightly more expensive than others

## CI Execution

The GitHub Actions workflow `.github/workflows/type-check-performance.yml` runs automatically on:

- Pull request creation
- Push to main branch
- Manual execution (workflow_dispatch)

Using **octocov**, it compares against past measurements and automatically detects performance degradation. PR comments display:

- Comparison of current and previous values for each metric
- Rate of change (percentage increase/decrease)
- Performance degradation warnings

## Operational Guidelines

### Judgment Thresholds

When reviewing PR results, focus on **Instantiations** as the most stable indicator:

| Metric         | Warning Threshold | Critical Threshold | Action Required                       |
| -------------- | ----------------- | ------------------ | ------------------------------------- |
| Instantiations | >5% increase      | >15% increase      | Review type definitions               |
| Types          | >10% increase     | >30% increase      | Check for unnecessary type generation |

**Note**: Time-based metrics can vary due to CI runner performance. Focus on instantiation counts.

### How to Interpret Results

1. **No significant change (< 5% variation)**: Safe to merge
2. **Minor increase (5-15%)**: Review changes, acceptable if justified by new features
3. **Major increase (> 15%)**: Investigate root cause before merging

### Identifying Performance Issues

Use feature-based results to identify which feature is causing performance degradation:

1. **High resolver-nested impact**: Review nested object types in input/output
2. **High resolver-array impact**: Check array type usage complexity
3. **High tailordb-object impact**: Simplify nested object field definitions
4. **High tailordb-hooks impact**: Review hook function type definitions

### Common Causes of Performance Degradation

1. **Deep generic nesting**: Complex nested generic types cause exponential instantiation growth
2. **Union type explosion**: Large union types combined with mapped types
3. **Recursive type definitions**: Self-referential types without proper termination
4. **Excessive overloads**: Many function overloads increase resolution time

### Remediation Steps

If performance degradation is detected:

1. **Identify the feature**: Check which feature shows the largest increase
2. **Profile locally**: Run `pnpm --filter example perf:typecheck:inference` locally
3. **Simplify types**: Consider type aliases or breaking down complex types
4. **Add benchmarks**: If new patterns are introduced, add to the feature test suite

## Implementation Details

### Scripts

- **`run-typecheck-full.sh`**: Executes type checking for the entire project
  - Generates types with `pnpm generate`
  - Collects diagnostics with TypeScript compiler
  - Pipes to `process-results.ts` for processing

- **`run-typecheck-inference.sh`**: Measures type inference for each feature
  - Tests each static feature file in `features/` directory
  - Outputs results sorted by instantiation count

- **`features/`**: Static test files for each SDK feature
  - Each file contains 10 definitions using a specific SDK feature
  - Breaking API changes will cause type errors in these files
  - Easy to maintain and review in code reviews

- **`process-results.ts`**: Converts TypeScript diagnostics output to octocov-compatible JSON format
  - Reads diagnostics from stdin
  - Filters to key metrics (types, instantiations, check-time, total-time)
  - Outputs metrics in octocov format

### Configuration Files

- **`.octocov.perf.yml`**: octocov configuration for PR comparison
  - Tracks key features (full, resolver-_, tailordb-_)
  - Compares against main branch baseline
  - Posts comparison comment on PR
- **`.octocov.perf.main.yml`**: octocov configuration for main branch baseline
  - Stores baseline metrics for future PR comparisons
  - Does not post comments

## Reference

This implementation is inspired by the `perf-measures/type-check` in [honojs/hono](https://github.com/honojs/hono).
