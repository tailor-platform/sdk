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

### Solve Mode (Podman + Ollama)

Solve runs `opencode` inside a Podman container; inference is served by a host-side Ollama daemon that the container reaches via `host.containers.internal:11434`.

- **Podman required**: `podman machine start` on macOS. Container image auto-builds on first run (`llm-challenge-runner`).
- **Ollama required** (host-side):
  ```bash
  brew install ollama
  ollama pull qwen2.5-coder:7b
  OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 \
    OLLAMA_NUM_PARALLEL=1 OLLAMA_CONTEXT_LENGTH=16384 ollama serve
  ```
  `OLLAMA_CONTEXT_LENGTH` must be raised above the 2k default for opencode's tool-calling path; `16384` is safe on an 18 GB Mac with `qwen2.5-coder:7b` (≈4.7 GB resident). 24 GB+ hosts can use `32768` for longer tool chains. The harness's `checkAuthStatus` probes `http://localhost:11434/api/tags` before launching a run and emits the same hint if the daemon is unreachable.
- **No cloud credentials** — local inference, so no API spend and no rate limits. The only enforcement axis is `--max-seconds` (default `3600` per problem).
- **Default model**: `qwen2.5-coder:7b`. Override with `--model <ollama-id>`; the value is passed through as `ollama/<id>`. Heavier alternatives (`gpt-oss:20b`, `qwen3-coder:30b`) are viable on hosts with more RAM at the cost of throughput.
- **Reproducibility**: each iteration writes a per-run `opencode.json` carrying `temperature=0.2` and `seed=<iteration index>` under `provider.ollama.options`. Re-running the same `(problem, iteration)` pair is deterministic up to whatever non-determinism the Ollama runtime itself introduces.

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

- Read existing tests in `problems/m*/tests/` for patterns
- Helpers: `shared/test-helpers.ts` (`createWorkDirContext`, `importPath`, `expectFieldType`, etc.)
- Mocks: `shared/mocks.ts` (`setupTailordbMock`, `setupWorkflowMock`, `setupWaitPointMock`)
- ALWAYS use `describe.skipIf(!workDirReady)` guard so missing work dirs degrade to skipped, not crashed

## Creating a New Problem

1. Pick the next free `m<NN>` id (`ls llm-challenge/problems/`)
2. Write `solution/` first — it forces you to confirm the API actually expresses the intent
3. Write `tests/` against the solution
4. Add per-problem `scaffold/` overrides only when shared scaffold is insufficient
5. Verify: `pnpm -C llm-challenge challenge --problem m<NN> --use-solution` → must pass all three stages
6. Manually solve the problem once with `--solve` to confirm it lands in the 5-15 turn range

## Problem Lifecycle

To prevent the ceiling-effect that comes from keeping uniformly-passing problems in active rotation, problems graduate through three states:

- **active** — `problems/<id>/` (default). Included in every `challenge:solve` run.
- **archived** — `problems/archived/<id>/`. Excluded from `challenge:solve` (the loader skips this subtree) but still picked up by `challenge:analyze --include-archived` so historical trend lines stay continuous.

**Graduation rule.** Move a problem into `archived/` once it shows **5 consecutive runs** with `passRate = 1.0` AND `metricsStdev.turns / metricsMedian.turns < 0.1` on the **types-only** profile (the stricter one). At that point the SDK affordance is well-enough surfaced that further evaluation cost on this problem is wasteful. The decision is reversible: move the directory back if a later SDK regression flips the outcome.

**Bookkeeping.** When moving:

1. `mv llm-challenge/problems/<id> llm-challenge/problems/archived/<id>`
2. Add a line under "## Archived" in the problem's `problem.md` (if present) noting the run that graduated it.
3. If a renamed successor exists, add `<id>` to that successor's `meta.json` `aliases` list so `--unify-aliases` can stitch the history.

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
- The host Ollama daemon serialises generations internally; N parallel solves divide effective throughput by N rather than multiplying it. Useful when the configs differ (e.g. `types-only` vs `full-package`) so the parallel work is genuinely independent.

After parallel runs finish, use `pnpm -C llm-challenge challenge:analyze --groups` to list per-config groups and `--trend --context-profile <profile>` to inspect a single config's history.
