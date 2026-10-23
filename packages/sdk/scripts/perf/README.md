# Type Performance Measurement

`attest/*.bench.ts` measure how many type instantiations a single SDK expression (a "case") costs, using [`@ark/attest`](https://arktype.io/docs/attest/benches). More instantiations mean slower type checking and slower editor feedback for SDK users.

`runtime-perf.sh` measures the runtime of the CLI commands separately.

## Cases

Each case is one `bench("<name>", () => …)` call. The files group the cases by area, and each file has its own `bench.baseline(…)` expression that warms the types the cases of that file share, so a case counts only its own expression.

| File                | Cases                                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseline.bench.ts` | `tailordb-baseline`, `resolver-baseline`, `executor-baseline`                                                                                                                                                                                                       |
| `tailordb.bench.ts` | `tailordb-basic`, `tailordb-optional`, `tailordb-relation`, `tailordb-validate`, `tailordb-hooks`, `tailordb-object`, `tailordb-enum`                                                                                                                               |
| `resolver.bench.ts` | `resolver-basic`, `resolver-nested`, `resolver-array`                                                                                                                                                                                                               |
| `executor.bench.ts` | `executor-schedule`, `executor-webhook`, `executor-record-created`, `executor-record-updated`, `executor-record-deleted`, `executor-resolver`, `executor-operation-function`, `executor-operation-gql`, `executor-operation-webhook`, `executor-operation-workflow` |

Executor trigger cases use a `graphql` operation, and executor operation cases use `incomingWebhookTrigger`, so each case isolates one of the two.

The `*-baseline` cases measure the `bench.baseline` expression of each area on its own, without any warm-up. Because the other cases do not pay for what the baseline already instantiated, growth in the shared types shows up in these cases. If you change a `bench.baseline` expression, change its `*-baseline` case in `baseline.bench.ts` to match.

Results are listed in this order: baseline, tailordb, resolver, executor, and in definition order within a file.

## Running locally

```bash
pnpm --filter @tailor-platform/sdk perf:attest
```

This runs every bench file, writes the measured count into the trailing `.types([N, "instantiations"])` of each case (attest's own snapshot, as in arktype's `benchUp`), and writes `attest-metrics.json` and `attest-changes.md`. Commit the updated numbers when you change a count on purpose; CI does not compare against them.

To add a case, write `bench("<name>", () => …).types()` in the file of its area and run the command; attest fills in the count.

## CI

The `Type Performance` job of `.github/workflows/sdk-metrics.yml` runs the same command. A change in a count never fails CI; a bench that crashes does, so the broken measurement is noticed.

- The measured counts go to octocov as the `type-performance` custom metric and to the step summary, so the PR comment shows the difference from `main`.
- In pull requests, the job also runs the bench files, copied from the pull request, against the base commit's `packages/sdk`. The cases whose count differs are listed in the PR comment and the step summary, in the order above, each with the measured code.
- Both runs resolve dependencies from the pull request's `node_modules`, so a change caused only by a dependency update (for example `zod`) shows no difference.

## When a case gets heavier

1. Find the case in the PR comment and read the code next to it; that is the expression whose cost changed.
2. Run the command locally on both commits to confirm the numbers.
3. Look for deep generic nesting, large unions combined with mapped types, recursive types without termination, and many overloads.

## Reference

This is modelled on how [arktype](https://github.com/arktypeio/arktype) uses attest, and the original type-check measurement was inspired by `perf-measures/type-check` in [honojs/hono](https://github.com/honojs/hono).
