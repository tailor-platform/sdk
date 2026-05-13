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

When AI fails a challenge, **improve the SDK** (JSDoc, error messages, types, CLAUDE.md) — NEVER add hints to `problem.md`.

## Prerequisites

- ALWAYS build the SDK before running: `pnpm -C packages/sdk build`
- ALWAYS run `pnpm install` at repo root before benchmarks (stale workspace deps break the verify pipeline)

### Solve Mode (Podman)

Solve runs inside a Podman container for filesystem isolation.

- **Podman required**: `podman machine start` on macOS
- **Claude auth**: `claude setup-token` then `export CLAUDE_CODE_OAUTH_TOKEN=<token>`
- **Codex auth**: `codex login` (stores credentials in `~/.codex/auth.json`, mounted into the container)
- Container image auto-builds on first run (`llm-challenge-runner`)

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
  "hint": "db.string() is required by default; chain .unique()."
}
```

- `id`: `m<NN>-<slug>` (sequential; next free is `m26+`).
- `designNote`: free-form author note about the affordance gap the problem exercises. Documentation only; the runner does not read it.
- `sdkSurface`: closed enum — `db-field`, `db-type`, `resolver`, `executor-record-trigger`, `executor-non-record-trigger`, `executor`, `workflow`, `config`, `plugin`, `auth-idp`, `cli-runtime`.
- `contextProfiles`: subset of `["types-only", "full-package"]`.
- `hint`: optional one-line hint; omit for pure docs-gap problems where docs absence IS the test.

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
6. Manually solve the problem once with Claude to confirm it lands in the 5-15 turn range

## SDK Improvement Cycle

1. `pnpm -C llm-challenge challenge:solve --context-profile types-only` (and again with `--context-profile full-package`)
2. `pnpm challenge:analyze --trend --context-profile types-only` and `--context-profile full-package` to see pass-rate history per profile
3. For problems where `full-package` passes but `types-only` fails (or where iteration pass rate is in `(0, 1)`), open the failing iteration's `trace.jsonl` and the per-attempt `work/` snapshot to identify the root cause manually
4. Propose SDK changes — prefer compile-time/JSDoc/error-message changes over docs-only fixes
5. `pnpm -C packages/sdk build`, then re-run `challenge:solve` on the same `(agent, model, profile)` to measure delta

A/B experiments via `pnpm challenge:experiment --sdk-branch <ref> --iterations <n>` run the benchmark twice (baseline tree + candidate ref), copy both reports into `results/experiments/<exp-id>/`, and emit a `delta.json` plus a printed ΔpassRate / ΔcostUSD summary. Forwarded flags (`--problem`, `--agent`, `--model`, `--context-profile`, `--concurrency`, …) are passed through to both child runs after the reserved flags are stripped.

## Parallel Runs

Reports and per-run work trees are isolated per `(agent, model, context-profile)`, so multiple `pnpm challenge:solve` invocations can run concurrently from separate shells:

```bash
for profile in types-only full-package; do
  pnpm -C llm-challenge challenge:solve \
    --agent claude --model sonnet \
    --context-profile "$profile" \
    > ".agent/tmp/llm-challenge-logs/$profile.log" 2>&1 &
done
wait
```

Caveats:

- Pre-build the SDK once before launching parallel runs; concurrent builds race
- Let the container image build finish on a single solve before fanning out
- API rate limits apply per credential — N profiles in parallel = N concurrent agent sessions

After parallel runs finish, use `pnpm -C llm-challenge challenge:analyze --groups` to list per-config groups and `--trend --context-profile <profile>` to inspect a single config's history.
