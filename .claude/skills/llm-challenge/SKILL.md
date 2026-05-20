---
name: llm-challenge
description: >
  Manage the LLM Challenge benchmark: run benchmarks, create/modify
  micro-problems, analyze results, run A/B experiments, and improve SDK based
  on profile-diff and iteration-variance signals.
  Use when user mentions "llm-challenge", "challenge", "benchmark", or "lc".
metadata:
  internal: true
---

# LLM Challenge

Benchmark for `@tailor-platform/sdk` AI-friendliness. Located at `llm-challenge/`.

Read `llm-challenge/README.md` for the full command surface and report shape.

## Core Rule

When AI fails a challenge, **improve the SDK** (JSDoc, error messages, types, CLAUDE.md) — NEVER add hints to `problem.md`. The `_hintAuthorOnly` field on `meta.json` is an author-only memo and MUST NOT be referenced from `core/solve.ts`; the `PromptSafeMeta = Omit<ProblemMeta, "_hintAuthorOnly">` constraint on `buildPrompt()` enforces this at compile time.

## Prerequisites

- ALWAYS build the SDK before running: `pnpm -C packages/sdk build`
- ALWAYS run `pnpm install` at repo root before benchmarks (stale workspace deps break the verify pipeline)

### Solve Mode (Podman + codex CLI)

Solve runs the OpenAI `codex` CLI inside an ephemeral Podman container. Inference hits `api.openai.com` directly; the container only mounts the work tree and a read-only copy of `~/.codex/auth.json`, so host dotfiles (global `AGENTS.md`, skills, etc.) cannot leak into the prompt.

- **Podman required**: `podman machine start` on macOS. Container image (`llm-challenge-runner`) auto-builds on first run and bakes in the `@openai/codex` CLI.
- **codex login on the host**: run `codex login` once. This writes `~/.codex/auth.json` (or `$CODEX_HOME/auth.json` when set); the runner bind-mounts that single file read-only into the container. A **ChatGPT subscription** with codex CLI entitlement is required — there is no API-key path in this harness.
- **Model is pinned** to `gpt-5.5` in `core/solver/codex.ts`. Varying the model is an experiment-level decision; do not parameterise it from the CLI. There is no `--model` flag.
- **Reasoning budget**: `--effort <minimal|low|medium|high|xhigh>` (default `xhigh`), forwarded as `-c model_reasoning_effort=<effort>`. The affordance signal lives at the upper end; use lower values only for smoke-testing harness changes.
- **Enforcement axes**: `--max-seconds` (default `3600` per problem) is the only wall-clock cap. The ChatGPT subscription's per-user rate budget applies on top.
- **Reproducibility**: `gpt-5` reasoning models accept neither a useful seed nor an adjustable temperature, so determinism is not pursued at the request level. Instead the harness samples `N=5` iterations per `(problem, effort, profile)` task and reports the variance directly (`--iterations`, default `5` in solve mode and `1` in verify mode).

## Problem Conventions

Structure: `problems/<id>-<slug>/` with `meta.json`, `problem.md`, `scaffold/`, `solution/`, `tests/`. Shared scaffold lives at `problems/_shared/scaffold/`.

**meta.json schema** (new micro-problem shape — no scoring weights, no apiCheck, no split):

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

- `id`: `m<NN>-<slug>` (sequential; next free is `m26+`).
- `designNote`: free-form author note about the affordance gap the problem exercises. Documentation only; the runner does not read it.
- `sdkSurface`: closed enum — `db-field`, `db-type`, `resolver`, `executor-record-trigger`, `executor-non-record-trigger`, `executor`, `workflow`, `config`, `plugin`, `auth-idp`, `cli-runtime`.
- `contextProfiles`: subset of `["types-only", "full-package"]`.
- `_hintAuthorOnly`: optional one-line author memo. NEVER read by the runner — kept in `meta.json` purely as documentation of authorial intent. The leading underscore signals "do not surface" to both future authors and the type system (`PromptSafeMeta` omits it). Legacy `hint` field is read as a fallback so older problems still load.
- `aliases`: optional list of older problem IDs that were renamed to this one. Off-default for trend/diff aggregation; pass `--unify-aliases` to follow.
- `verifyCommands`: optional shell commands to run after `tailor-sdk generate` but before `tsc --noEmit`, exposed as a `verify-commands` stage. Use to evaluate CLI subcommand operation (e.g. `node packages/sdk/dist/cli/index.mjs tailordb migration generate --dry-run`). Binary pass/fail per command; first failure short-circuits remaining commands but typecheck/tests still run.

**problem.md rules**:

- Sections: Goal → Domain Context/Instructions → What to Build → Requirements → Reference
- NEVER include SDK code examples — the agent must discover the API from the installed SDK package
- Always end with "Refer to the installed SDK package for ..."

## Writing Tests

- Read existing tests in `problems/{m,h}*/tests/` for patterns
- Helpers: `shared/test-helpers.ts` (`createWorkDirContext`, `importPath`, `expectFieldType`, `expectFunctionOperation`, `expectNonEmptyDescription`, `stripComments`)
- ALWAYS use `describe.skipIf(!workDirReady)` guard so missing work dirs degrade to skipped, not crashed

## Creating a New Problem

1. Pick the next free `m<NN>` id (`ls llm-challenge/problems/`)
2. Write `solution/` first — it forces you to confirm the API actually expresses the intent
3. Write `tests/` against the solution
4. Add per-problem `scaffold/` overrides only when shared scaffold is insufficient
5. Verify: `pnpm -C llm-challenge challenge --problem m<NN> --use-solution` → must pass all three stages
6. Manually solve the problem once with `--solve` to confirm it lands in the 5-15 turn range

## Problem Lifecycle

To prevent the ceiling-effect that comes from keeping uniformly-passing problems in active rotation, problems graduate through two states:

- **active** — `problems/<id>/` (default). Included in every `challenge:solve` run.
- **archived** — `problems/archived/<id>/`. Excluded from `challenge:solve` by default. Re-included by `challenge:solve --include-archived` (re-run) and by `challenge:analyze --include-archived` (history). Trend lines stitch across the boundary because alias / archived metadata is still read.

**Automatic graduation.** Solve completion runs `graduateProblems()` (`core/graduation.ts`). For every problem in the just-finished run the runner walks the 5 most recent reports in the same `(model, types-only)` group (including the new one) and moves `problems/<id>` → `problems/archived/<id>` when:

- the run's `contextProfile === "types-only"` (the stricter profile drives the rule), AND
- every one of the 5 reports contains the problem with `passRate === 1.0` (uses `iterations.passRate` when present, else the binary `passed` field), AND
- the **latest** report's `iterations.metricsStdev.turns / iterations.metricsMedian.turns < 0.1` (variance gate on the just-finished N=5 run; degenerate `median.turns === 0` resets the streak).

Graduation is automatic, but reversible: drop the problem back into `problems/<id>` to bring it into active rotation again. To re-run an archived problem ad-hoc without un-archiving it, pass `--include-archived` to `challenge:solve` (with `--all` or `--problem <id>` / `--problem archived/<dir>`).

If a renamed successor exists for an archived problem, add the archived ID to the successor's `meta.json` `aliases` list so `--unify-aliases` can stitch the history.

## SDK Improvement Cycle

1. `pnpm -C llm-challenge challenge:solve --context-profile types-only` (and again with `--context-profile full-package`)
2. `pnpm challenge:analyze --trend --context-profile types-only` and `--context-profile full-package` to see pass-rate history per profile
3. For problems where `full-package` passes but `types-only` fails (or where iteration pass rate is in `(0, 1)`), open the failing iteration's `trace.jsonl` and the per-attempt `work/` snapshot to identify the root cause manually
4. Propose SDK changes — prefer compile-time/JSDoc/error-message changes over docs-only fixes
5. `pnpm -C packages/sdk build`, then re-run `challenge:solve` on the same `(model, profile)` to measure delta

A/B experiments via `pnpm challenge:experiment --sdk-branch <ref> --iterations <n>` run the benchmark twice (baseline tree + candidate ref), copy both reports into `results/experiments/<exp-id>/`, and emit a `delta.json` plus a printed ΔpassRate / Δturns summary. Forwarded flags (`--problem`, `--model`, `--context-profile`, `--concurrency`, `--max-seconds`, …) are passed through to both child runs after the reserved flags are stripped.

## Parallel Runs

Reports and per-run work trees are isolated per `(model, context-profile)`, so multiple `pnpm challenge:solve` invocations can run concurrently from separate shells:

```bash
for profile in types-only full-package; do
  pnpm -C llm-challenge challenge:solve \
    --context-profile "$profile" \
    > ".agent/tmp/llm-challenge-logs/$profile.log" 2>&1 &
done
wait
```

Caveats:

- Pre-build the SDK once before launching parallel runs; concurrent builds race
- Let the container image build finish on a single solve before fanning out
- The ChatGPT subscription serialises requests through a per-user rate budget; N parallel solves divide effective throughput by N rather than multiplying it. Useful when the configs differ (e.g. `types-only` vs `full-package`) so the parallel work is genuinely independent.

After parallel runs finish, use `pnpm -C llm-challenge challenge:analyze --groups` to list per-config groups and `--trend --context-profile <profile>` to inspect a single config's history.
