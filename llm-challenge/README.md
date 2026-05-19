# LLM Challenge

A benchmark for measuring how AI-friendly `@tailor-platform/sdk` is. The OpenAI codex CLI (running on a ChatGPT subscription) solves small implementation problems against the SDK — when it fails, the failure signals that the SDK lacks discoverability, not that the agent is incapable.

## Improvement Philosophy

When the agent fails a challenge, the correct response is to **improve the SDK itself**, not to add hints to the problem description. The benchmark exists to surface those gaps, not to grade the model. Concretely:

- Add JSDoc and `@example` blocks to SDK types and functions.
- Tighten error messages so they name the next concrete action.
- Promote runtime invariants to compile-time constraints when possible.
- Enrich `CLAUDE.md` patterns and `docs/`.

This iteration of the harness is built around three ideas:

1. **Micro-problems** (5-15 turns each) that isolate one affordance per problem, so failures are diagnostic.
2. **Behaviour trace** — every agent run streams `tool_use` events to `trace.jsonl` so we measure what the agent actually did, not just whether it succeeded.
3. **Profile diff + iteration variance** — comparing types-only vs full-package pass rates across N≥3 iterations is the primary docs-vs-types-gap detector.

Inference runs against `api.openai.com` through the codex CLI, authenticated with a ChatGPT subscription. The codex process itself executes inside an ephemeral Podman container — the host filesystem is unreachable except for the work tree and a read-only mount of `~/.codex/auth.json`, so global agent instructions, skills, and dotfiles cannot leak into the prompt. Reproducibility relies on the model's own sampling stability rather than on explicit seeds: gpt-5 reasoning models accept neither a useful seed nor an adjustable temperature, so we sample `N=5` iterations per `(problem, effort)` pair and report the variance directly.

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

Solve mode requires two pieces of local infrastructure:

- **Podman** — solve mode runs each problem inside an ephemeral container that isolates the work tree.
  On macOS: `podman machine start`. The runner image (`llm-challenge-runner`) auto-builds on first use and bakes in the `@openai/codex` CLI.
- **A codex login on the host** — run `codex login` once. This writes `~/.codex/auth.json` (or `$CODEX_HOME/auth.json` when set); the runner bind-mounts that single file read-only into the container so codex can authenticate. Nothing else from your home directory is mounted, so global `AGENTS.md`, skills, or other dotfiles are invisible to the agent. A ChatGPT subscription with codex CLI entitlement is required.

The harness pins the model to `gpt-5.5` (see `core/solver/codex.ts`). Tune the reasoning budget with `--effort <minimal|low|medium|high|xhigh>` (default `xhigh`). The per-problem wall-clock cap (`--max-seconds`, default `3600`) is the only other axis of enforcement.

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
pnpm challenge:analyze --groups   # list every (model, context-profile) group
pnpm challenge:analyze --trend --context-profile types-only
```

**Flags accepted by `--solve`:**

- `--effort <minimal|low|medium|high|xhigh>` — codex reasoning effort, forwarded as `-c model_reasoning_effort=<effort>`. Default: `xhigh`. Use lower values when smoke-testing changes to the harness itself; the affordance signal lives at the upper end.
- `--max-seconds <n>` — per-problem wall-clock cap in seconds (default `3600`). Replaces the legacy `--max-budget` flag.
- `--context-profile <types-only|full-package>` — what slice of the SDK is exposed inside the work tree. `types-only` is the API-design baseline; `full-package` ships the whole tarball.
- `--concurrency <n>` — parallel problems (default `1`). The ChatGPT subscription enforces a per-user rate budget, so raising this above 1 is only useful when running against a higher tier or an independent account.
- `--iterations <n>` — repeat each `(problem, effort, profile)` task N times for variance bounds (default: `5` in solve mode, `1` in verify mode). When N > 1 the report's `results[].iterations` block carries pass rate and median±stdev for the behavioural metrics.
- `--no-early-stop` — disable the agreement-based early termination of the iteration loop. Only active when the run uses the legacy `--iterations 3` cadence; the N=5 default samples every iteration directly.
- `--no-auto-extend` — suppress the flaky-middle-band auto-extension. Only active under `--iterations 3`.
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

When `--solve` runs, codex is invoked with `exec --json` and every `item.completed` / `turn.completed` / `error` event is normalised into `trace.jsonl` under the per-attempt artifact directory (see [`core/trace.ts`](core/trace.ts)). Codex's lower-snake item types (`command_execution`, `file_change`, …) are mapped onto Pascal-case tool names (`Bash`, `Edit`, `WebSearch`, …) so downstream metric counters keep working unchanged.

[`core/metrics.ts`](core/metrics.ts) aggregates the trace into a small vector per problem:

- `turns` — number of `tool_use` events (proxy for "how much did the agent thrash?").
- `toolCallCounts` — per-tool frequencies (`Read`, `Bash`, `Edit`, …).
- `readSdkDts` — `Read` hits on `node_modules/@tailor-platform/sdk/**/*.d.ts`.
- `readDocs` — `Read` hits on `docs/` or `README*`.
- `bashRetries` — `Bash` invocations of `tsc` / `vitest` / `tailor-sdk generate` / `pnpm test` (loop detector).

Aggregated min/median/max/mean across the run land in `analytics.metricsSummary` of the report.

## Reports & Analytics

Each run writes `results/<model-context-profile>/report-<sdkVersion>-<runId>.json`. Report shape (see [`core/report.ts`](core/report.ts)):

- `results[]` — per-problem result (`problemId`, `passed`, `stages[]`, `metrics?`, `solveResult?`).
- `analytics.stagePassRates` — pass rate per stage across the run.
- `analytics.metricsSummary` — min/median/max/mean of `turns`, `readSdkDts`, `readDocs`, `bashRetries` across problems with traces.
- `usageSummary` — aggregate `inputTokens` / `outputTokens` / `cacheReadTokens` / `numTurns` (context-bloat sensor).
- `model`, `contextProfile`, `sdkVersion`, `timestamp` — one-liner metadata for trend grouping.

The terminal table summarises per-problem stage status and the trace line (`turns=… read_sdk=… read_docs=… bash_retries=…`).

## A/B Experiments

```bash
# Pack tarballs from the current tree and the candidate branch, run both.
pnpm challenge:experiment --sdk-branch feat/exec-description-required \
  --all --context-profile types-only

# Narrow to specific problems (forwarded as multiple --problem flags).
pnpm challenge:experiment --sdk-branch feat/exec-description-required \
  --problems m05,m18 --context-profile types-only
```

This:

1. Runs the full problem set against the **current working tree** (baseline) with N iterations per problem. Default `N = 5`.
2. `git worktree add`s the `--sdk-branch` ref into `.agent/tmp/sdk-branch-<ref>-XXXXXX/`, builds the SDK there, `pnpm pack`s it, then runs the same problem set against that tarball.
3. Writes `results/experiments/<exp-id>/{baseline,candidate,delta}.json` where `delta.json` is the structured A/B diff (per-problem `passRateDelta`, `metricsDelta`, `readDeltas`).

Run the diff alone against two existing reports (no new solves):

```bash
pnpm challenge:analyze --diff path/to/baseline.json path/to/candidate.json [--json]
```

As a working manual interpretation example, an acceptable improvement is one where `passRate` rises and the per-problem `metricsStdev.turns` stays below `median × 0.3` — i.e., the change is large relative to inter-iteration noise. **This threshold is a guideline for manual review; it is not enforced by the harness.**

Forward flags (`--all`, `--problem <id>`, `--effort`, `--context-profile`, `--concurrency`, `--max-seconds`, `--clean`) are passed through to both child runs by `pnpm challenge:experiment` after stripping the reserved flags it owns (`--solve`, `--iterations`, `--sdk-branch`, `--problems`). When `--problems <ids>` is set, the driver expands it into multiple `--problem <id>` arguments on both child invocations.

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
  "_hintAuthorOnly": "db.string() is required by default; chain .unique()."
}
```

`designNote` is a free-form author note about the affordance gap the problem exercises; it is documentation only and is not read by the runner. `_hintAuthorOnly` is enforced by the `PromptSafeMeta = Omit<ProblemMeta, "_hintAuthorOnly">` type constraint on `buildPrompt()` — the field cannot leak into the prompt the agent sees.

Scaffold resolution is a four-layer overlay (later layers shadow earlier ones at file granularity):

1. `shared/scaffold/` — legacy global scaffold.
2. `problems/_shared/scaffold/` — shared micro-problem layer.
3. `problems/<id>/scaffold/` — per-problem overrides.
4. The implementation directory (`--use-solution`, `--impl`, or the agent's work tree for `--solve`).

## Solve Artifacts

Solve runs persist per-problem evidence under `results/artifacts/<run>/<problem>/`:

- `attempt-0/prompt.md` — the prompt the agent saw.
- `attempt-0/stdout.log`, `attempt-0/stderr.log` — raw agent output.
- `attempt-0/result.json` — parsed `SolveResult` (usage, duration).
- `attempt-0/trace.jsonl` — the behaviour trace stream.
- `attempt-0/work/` — final work tree snapshot (excludes `node_modules/`, `.sdk/`, `.git/`).

When `--iterations N` is set (default `N = 5`), per-iteration artifacts live under `iter-0/`, `iter-1/`, … each carrying the same `attempt-0/` shape.

## Parallel Runs

Reports and per-run work trees are isolated per `(model, context-profile)`, so multiple `pnpm challenge:solve` invocations can run in parallel from separate shells without clobbering each other:

```bash
for profile in types-only full-package; do
  pnpm -C llm-challenge challenge:solve \
    --context-profile "$profile" \
    > ".agent/tmp/llm-challenge-logs/$profile.log" 2>&1 &
done
wait
```

Caveats:

- Pre-build the SDK once (`pnpm -C packages/sdk build`) before launching parallel runs; concurrent builds race.
- The container image (`llm-challenge-runner`) auto-builds on first use — kick off one solve and let it finish that build, then fan out, or pre-build manually.
- The ChatGPT subscription serialises requests through a per-user rate budget; running N parallel solves divides effective throughput by N rather than multiplying it. Useful when the configs differ (e.g. `types-only` vs `full-package`) so the parallel work is genuinely independent.

After parallel runs finish, use `pnpm challenge:analyze --groups` to list per-config groups and `--trend --context-profile <profile>` to inspect a single config's history.

## Analyzing Reports

### Default analyze workflow

`pnpm challenge:analyze` with no flags is the recommended starting point. It chains two views:

1. **Trend** within the most recently active `(model, context-profile)` group — the time series of pass rate across reports in that group.
2. **Profile diff** — the latest representative reports from the `types-only` and `full-package` profiles for the same model are diffed against each other. This surfaces docs-vs-types affordance gaps automatically; if one profile has no reports yet the section is skipped with a single warning.

```bash
# Default: trend + profile diff for the active group.
pnpm challenge:analyze

# Manual profile diff only (no trend section).
pnpm challenge:analyze --profile-diff

# Ad-hoc A/B comparison between two specific reports.
pnpm challenge:analyze --diff path/to/baseline.json path/to/candidate.json [--json]

# Time-series trend within a specific group.
pnpm challenge:analyze --trend --model codex-gpt-5.5-xhigh --context-profile types-only

# List every (model, context-profile) group with its latest pass rate.
pnpm challenge:analyze --groups
```

The trend view diffs the first and last reports in the chosen group. The previous `--baseline <path>` flag is gone — trend within a group covers the same use cases.

### Reading the profile-diff table

Per-problem rows include `passA`, `passB`, `Δpass`, `stdevA`, `stdevB` (`iterations.metricsStdev.turns` from each side, when present), and `Δturns`. When a problem has at least one non-zero per-bucket readTargets delta, a compact line is rendered directly under the row:

```
read deltas: sdk-dts=+2 sdk-pkg-src=±0 sdk-docs=-1 problem-files=+3 other=±0
```

Buckets with `null` data (e.g. pre-Phase-5b reports that lack the per-class fields) are omitted from the line. The `sdk-dts` and `sdk-docs` buckets fall back to the legacy `readSdkDts` / `readDocs` aggregates when the per-bucket data is unavailable, so historical comparisons keep working.

Interpretation: a positive `sdk-docs` delta means "the candidate solver consulted SDK docs more often"; a positive `problem-files` delta means "the candidate spent more time exploring the problem's own scaffold and tests". When `Δpass` is negative but a single bucket spiked, the spike is the affordance-gap candidate to investigate.

### Iter-diff artifact

When a problem is flaky (passRate strictly between 0 and 1 across the N iterations) the harness writes `<runArtifactRoot>/iter-diff/<problemId>.diff` — a `git diff --no-index` between the first failing iteration's work snapshot and the first passing one. This is the canonical "what did the agent do differently between attempts" surface for manual review; pair it with the read-deltas line to triangulate which inputs actually changed.
