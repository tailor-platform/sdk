# LLM Challenge

A benchmark for measuring how AI-friendly `@tailor-platform/sdk` is. Autonomous coding agents (Claude Code, Codex) solve small implementation problems against the SDK — when they fail, the failure signals that the SDK lacks discoverability, not that the agent is incapable.

## Improvement Philosophy

When an agent fails a challenge, the correct response is to **improve the SDK itself**, not to add hints to the problem description. The benchmark exists to surface those gaps, not to grade the model. Concretely:

- Add JSDoc and `@example` blocks to SDK types and functions.
- Tighten error messages so they name the next concrete action.
- Promote runtime invariants to compile-time constraints when possible.
- Enrich `CLAUDE.md` patterns and `docs/`.

This iteration of the harness is a radical rebuild around three ideas:

1. **Micro-problems** (5-15 turns each) that isolate one affordance per problem, so failures are diagnostic.
2. **Behaviour trace** — every agent run streams `tool_use` events to `trace.jsonl` so we measure what the agent actually did, not just whether it succeeded.
3. **Profile diff + iteration variance** — comparing types-only vs full-package pass rates across N≥3 iterations is the primary docs-vs-types-gap detector.

## Problems

The legacy mega-problems (`001-saas-subscription-platform`, `002-tailordb-api-design`) have been retired in favour of 25 micro-problems under `problems/m01-…` through `problems/m25-…`. Each one exercises one SDK surface and one hypothesised affordance gap.

Coverage by SDK surface:

| Surface                       | Count | Problem IDs |
| ----------------------------- | ----- | ----------- |
| db field                      | 4     | m01-m04     |
| db type                       | 3     | m05-m07     |
| resolver                      | 3     | m08-m10     |
| executor (record trigger)     | 1     | m11         |
| executor (non-record trigger) | 2     | m12, m13    |
| executor (body)               | 1     | m14         |
| workflow + wait point         | 2     | m15, m16    |
| config                        | 2     | m17, m18    |
| plugin                        | 2     | m19, m20    |
| idp + auth                    | 1     | m21         |
| CLI / runtime                 | 4     | m22-m25     |

See [`.agent/tmp/2026-05-13-micro-problem-inventory.md`](../.agent/tmp/2026-05-13-micro-problem-inventory.md) for the full design matrix mapping each problem to its `designNote`.

## Prerequisites

```bash
# Build the SDK once before running anything.
pnpm -C packages/sdk build
```

Solve mode needs its own credentials:

- **Podman** — Solve mode runs each problem inside an ephemeral container.
  On macOS: `podman machine start`.
- **Claude agent** — `claude setup-token`, then export `CLAUDE_CODE_OAUTH_TOKEN`.
- **Codex agent** — `codex login` (writes `~/.codex/auth.json`, which is mounted into the container).

## Commands

```bash
# Verify all problems against their reference solutions (no AI, fast, deterministic).
pnpm challenge:verify-solution

# Run the AI solver across every problem.
pnpm challenge:solve [flags]

# Run a single problem.
pnpm challenge --problem m01 --solve [flags]
pnpm challenge --problem m01 --use-solution
pnpm challenge --problem m01 --impl ./path/to/impl

# Run all problems against external implementation outputs.
pnpm challenge --all --impl-dir ./path/to/outputs

# Inspect history of past runs.
pnpm challenge:analyze            # latest group trend
pnpm challenge:analyze --groups   # list every (agent, model, profile) group
pnpm challenge:analyze --trend --agent claude --context-profile types-only
```

**Flags accepted by `--solve`:**

- `--agent <claude|codex>` — solver agent (default: `claude`).
- `--model <name>` — model id passed to the agent. Defaults: `sonnet` for Claude, the Codex CLI default for Codex.
- `--max-budget <usd>` — per-problem spend cap (default `5.00`).
- `--context-profile <types-only|full-package>` — what slice of the SDK is exposed inside the work tree. `types-only` is the API-design baseline; `full-package` ships the whole tarball.
- `--concurrency <n>` — parallel problems (default = `os.availableParallelism()`).
- `--iterations <n>` — repeat each `(problem, agent, model, profile)` task N times for variance bounds (default: `3` in solve mode, `1` in verify mode). When N > 1 the report's `results[].iterations` block carries pass rate, median cost, and median±stdev for the four behavioural metrics.
- `--sdk-branch <ref>` — pack the SDK from a git ref instead of the current working tree. Spawns a detached `git worktree`, builds the SDK there, and `pnpm pack`s the result. Requires `--solve`.
- `--clean` — remove work directories after the run.

## How Verification Works

Each problem runs through a three-stage pipeline. If a stage fails, later stages still execute so the report shows independent signal per stage.

| Stage         | What it does                                            |
| ------------- | ------------------------------------------------------- |
| **generate**  | `tailor-sdk generate` against the work tree             |
| **typecheck** | `tsc --noEmit` over the produced sources                |
| **tests**     | `vitest run` against the per-problem `tests/` directory |

Problem-level pass/fail is binary (`AND` of stage pass/fail). The tests stage additionally reports `testsPassed`/`testsTotal` so you can see partial test progress inside a failed problem.

There is no separate "API check" stage and no partial credit at the problem level. Per-stage scoring weights and the legacy four-category failure taxonomy are gone — they were noise at this granularity.

## Behaviour Trace

When `--solve` runs, the Claude solver is invoked with `--output-format stream-json` and every `tool_use` / `tool_result` / `turn_summary` event is appended to `trace.jsonl` under the per-attempt artifact directory (see [`core/trace.ts`](core/trace.ts)). Codex traces are derived from its structured CLI output.

[`core/metrics.ts`](core/metrics.ts) aggregates the trace into a small vector per problem:

- `turns` — number of `tool_use` events (proxy for "how much did the agent thrash?").
- `toolCallCounts` — per-tool frequencies (`Read`, `Bash`, `Edit`, …).
- `readSdkDts` — `Read` hits on `node_modules/@tailor-platform/sdk/**/*.d.ts`.
- `readDocs` — `Read` hits on `docs/` or `README*`.
- `bashRetries` — `Bash` invocations of `tsc` / `vitest` / `tailor-sdk generate` / `pnpm test` (loop detector).

Aggregated min/median/max/mean across the run land in `analytics.metricsSummary` of the report.

## Reports & Analytics

Each run writes `results/<agent-model-context-profile>/report-<sdkVersion>-<runId>.json`. Report shape (see [`core/report.ts`](core/report.ts)):

- `results[]` — per-problem result (`problemId`, `passed`, `stages[]`, `metrics?`, `solveResult?`).
- `analytics.stagePassRates` — pass rate per stage across the run.
- `analytics.metricsSummary` — min/median/max/mean of `turns`, `readSdkDts`, `readDocs`, `bashRetries` across problems with traces.
- `usageSummary` — aggregate `inputTokens` / `outputTokens` / `cacheReadTokens` / `numTurns` (context-bloat sensor).
- `model`, `contextProfile`, `sdkVersion`, `timestamp` — one-liner metadata for trend grouping.

The terminal table summarises per-problem stage status and the trace line (`turns=… read_sdk=… read_docs=… bash_retries=…`).

## A/B Experiments

```bash
# Pack tarballs from the current tree and the candidate branch, run both.
pnpm challenge:experiment --sdk-branch feat/exec-description-required --iterations 3 \
  --all --agent claude --context-profile types-only
```

This:

1. Runs the full problem set against the **current working tree** (baseline) with N iterations per problem.
2. `git worktree add`s the `--sdk-branch` ref into `.agent/tmp/sdk-branch-<ref>-XXXXXX/`, builds the SDK there, `pnpm pack`s it, then runs the same problem set against that tarball.
3. Writes `results/experiments/<exp-id>/{baseline,candidate,delta}.json` where `delta.json` is the structured A/B diff (per-problem `passRateDelta`, `costMedianDelta`, `metricsDelta`).

Run the diff alone against two existing reports (no new solves):

```bash
pnpm challenge:analyze --diff path/to/baseline.json path/to/candidate.json [--json]
```

As a working manual interpretation example, an acceptable improvement is one where `passRate` rises and the per-problem `costStdev` / `metricsStdev.turns` stays below `median × 0.3` — i.e., the change is large relative to inter-iteration noise. **This threshold is a guideline for manual review; it is not enforced by the harness.**

Forward flags (`--all`, `--problem <id>`, `--agent`, `--model`, `--context-profile`, `--concurrency`, `--max-budget`, `--clean`) are passed through to both child runs by `pnpm challenge:experiment` after stripping the reserved flags it owns (`--solve`, `--iterations`, `--sdk-branch`).

## Problem Structure

```
problems/
├── _shared/
│   └── scaffold/             # shared layer (package.json, tsconfig.json, tailor.config.ts, tailordb/)
├── m01-db-field-unique-required/
│   ├── meta.json
│   ├── problem.md
│   ├── scaffold/             # per-problem overrides (may be empty)
│   ├── solution/             # reference impl, used by --use-solution
│   └── tests/                # vitest specs
└── …
```

`meta.json` schema (new micro-problem shape):

```json
{
  "id": "m01-db-field-unique-required",
  "title": "Add a required + unique string field to a TailorDB type",
  "designNote": "implicit_assumption",
  "sdkSurface": "db-field",
  "contextProfiles": ["types-only", "full-package"],
  "hint": "db.string() is required by default; chain .unique()."
}
```

`designNote` is a free-form author note about the affordance gap the problem exercises; it is documentation only and is not read by the runner.

Scaffold resolution is a four-layer overlay (later layers shadow earlier ones at file granularity):

1. `shared/scaffold/` — legacy global scaffold.
2. `problems/_shared/scaffold/` — shared micro-problem layer.
3. `problems/<id>/scaffold/` — per-problem overrides.
4. The implementation directory (`--use-solution`, `--impl`, or the agent's work tree for `--solve`).

## Solve Artifacts

Solve runs persist per-problem evidence under `results/artifacts/<run>/<problem>/`:

- `attempt-0/prompt.md` — the prompt the agent saw.
- `attempt-0/stdout.log`, `attempt-0/stderr.log` — raw agent output.
- `attempt-0/result.json` — parsed `SolveResult` (cost, usage, duration).
- `attempt-0/trace.jsonl` — the behaviour trace stream.
- `attempt-0/work/` — final work tree snapshot (excludes `node_modules/`, `.sdk/`, `.git/`).

There is no `final-work/` snapshot anymore; `attempt-0/work/` is the canonical final state.

## Parallel Runs

Reports and per-run work trees are isolated per `(agent, model, context-profile)`, so multiple `pnpm challenge:solve` invocations can run in parallel from separate shells without clobbering each other:

```bash
for profile in types-only full-package; do
  pnpm -C llm-challenge challenge:solve \
    --agent claude --model opus \
    --context-profile "$profile" \
    > ".agent/tmp/llm-challenge-logs/$profile.log" 2>&1 &
done
wait
```

Caveats:

- Pre-build the SDK once (`pnpm -C packages/sdk build`) before launching parallel runs; concurrent builds race.
- The container image (`llm-challenge-runner`) auto-builds on first use — kick off one solve and let it finish that build, then fan out, or pre-build manually.
- API rate limits apply per credential; running N profiles in parallel multiplies concurrent agent sessions by N.

After parallel runs finish, use `pnpm challenge:analyze --groups` to list per-config groups and `--trend --context-profile <profile>` to inspect a single config's history.

## Analyzing Reports

```bash
# Default: trend within the most recently active matching group.
pnpm challenge:analyze

# List every (agent, model, context-profile) group with its latest pass rate.
pnpm challenge:analyze --groups

# Restrict trend to a specific slice.
pnpm challenge:analyze --trend --agent claude --model opus --context-profile types-only
```

The trend view diffs the first and last reports in the chosen group. The previous `--baseline <path>` flag is gone — trend within a group covers the same use cases.
