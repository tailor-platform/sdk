---
name: llm-challenge
description: >
  Manage the LLM Challenge benchmark: run benchmarks, create/modify
  micro-problems, analyze results, run A/B experiments, and improve SDK based
  on judge-surfaced affordance gaps.
  Use when user mentions "llm-challenge", "challenge", "benchmark", or "lc".
metadata:
  internal: true
---

# LLM Challenge

Benchmark for `@tailor-platform/sdk` AI-friendliness. Located at `llm-challenge/`.

Read `llm-challenge/README.md` for the full command surface, report shape, and the affordance taxonomy.

## Core Rule

When AI fails a challenge, **improve the SDK** (JSDoc, error messages, types, CLAUDE.md) — NEVER add hints to `problem.md`.

## Prerequisites

- ALWAYS build the SDK before running: `pnpm -C packages/sdk build`
- ALWAYS run `pnpm install` at repo root before benchmarks (stale workspace deps break the verify pipeline)
- The post-solve judge reuses `CLAUDE_CODE_OAUTH_TOKEN` (same credential as the Claude solver) by shelling out to `claude -p` on the host (not inside podman). Without a working `claude` CLI, judging is skipped and `improvement-candidates.jsonl` is not written

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
  "hypothesizedAffordance": "implicit_assumption",
  "sdkSurface": "db-field",
  "contextProfiles": ["types-only", "full-package"],
  "hint": "db.string() is required by default; chain .unique()."
}
```

- `id`: `m<NN>-<slug>` (sequential; next free is `m26+`).
- `hypothesizedAffordance`: one of the 12 seeded labels (see below) or free-form.
- `sdkSurface`: closed enum — `db-field`, `db-type`, `resolver`, `executor-record-trigger`, `executor-non-record-trigger`, `executor`, `workflow`, `config`, `plugin`, `auth-idp`, `cli-runtime`.
- `contextProfiles`: subset of `["types-only", "full-package"]`.
- `hint`: optional one-line hint; omit for `docs_only` problems where docs absence IS the test.

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
2. Open `results/artifacts/<run>/improvement-candidates.jsonl`; cluster entries by `affordanceLabel`
3. Pick the top cluster and read 1-2 candidates' `judge.diagnosis` + `trace.jsonl` to confirm the root cause
4. Propose SDK changes — prefer the candidate's `apiChange` over `docFallback` unless the change is too invasive
5. `pnpm -C packages/sdk build`, then re-run `challenge:solve` on the same `(agent, model, profile)` to measure delta
6. `pnpm challenge:analyze --trend --agent claude --context-profile types-only` to see pass-rate and affordance distribution diff

A/B experiments via `pnpm challenge:experiment --sdk-branch <ref>` are planned (Phase 4) but not yet wired; until then, switch branches manually between runs.

## Affordance Taxonomy

The judge prompt seeds these 12 labels; free-form labels are accepted when none fit.

- `consolidation_candidate` — merge sibling APIs
- `naming_bias` — rename to the verb agents reach for
- `context_bloat` — shrink default response
- `missing_namespace` — add a parent object or prefix
- `param_confusion` — tighten / rename parameters
- `missing_action_verb` — add a workflow-shaped action API
- `type_too_loose` — replace `any` / `unknown` with discriminated unions
- `type_too_strict` — relax types that reject valid agent inputs
- `redundant_call_pattern` — add idempotency / batching
- `implicit_assumption` — promote runtime preconditions to compile-time
- `error_message_opaque` — rewrite errors to name the next action
- `docs_only` — pure documentation gap

Source: `llm-challenge/core/judge.ts` (`SEED_AFFORDANCE_LABELS`).

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
