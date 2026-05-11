---
name: llm-challenge
description: >
  Manage the LLM Challenge benchmark: run benchmarks, create/modify problems,
  analyze results, and improve SDK based on failures.
  Use when user mentions "llm-challenge", "challenge", "benchmark", or "lc".
metadata:
  internal: true
---

# LLM Challenge

Benchmark for `@tailor-platform/sdk` AI-friendliness. Located at `llm-challenge/`.

Read `llm-challenge/README.md` for commands, scoring, and verification details.

## Core Rule

When AI fails a challenge, **improve the SDK** (JSDoc, error messages, types, CLAUDE.md) — NEVER add hints to `problem.md`.

## Prerequisites

- ALWAYS build SDK before running: `pnpm -C packages/sdk build`
- ALWAYS run `pnpm install` before benchmarks (stale dependencies break the verify pipeline)

### Solve Mode (Podman)

Solve runs inside a Podman container for filesystem isolation.

- **Podman required**: `podman machine start` on macOS
- **Claude auth**: `claude setup-token` then `export CLAUDE_CODE_OAUTH_TOKEN=<token>`
- **Codex auth**: `codex login` (stores credentials in `~/.codex/auth.json`, mounted into the container)
- Container image auto-builds on first run (`llm-challenge-runner`)

## Problem Conventions

Structure: `problems/<id>-<name>/` with `meta.json`, `problem.md`, `scaffold/`, `solution/`, `tests/`

**meta.json rules**:

- `id`: 3-digit zero-padded, sequential
- `scoring`: Category defaults — tailordb: 20/20/60, resolver/executor/workflow: 15/15/70, config: 30/20/50, fix-broken: 15/15/70
- Fix-broken problem: same file appears in both `implement` and `scaffold`

**problem.md rules**:

- Sections: Goal → Domain Context/Instructions → What to Build → Requirements → Reference
- NEVER include SDK code examples — AI must discover API from the SDK package itself
- Always end with "Refer to the installed SDK package for ..."

## Writing Tests

- Read existing tests in `problems/*/tests/` for patterns
- Helpers: `shared/test-helpers.ts` (`createWorkDirContext`, `importPath`, `expectFieldType`, etc.)
- Mocks: `shared/mocks.ts` (`setupTailordbMock`, `setupWorkflowMock`)
- ALWAYS use `describe.skipIf(!workDirReady)` guard

## Creating a New Problem

1. Next sequential ID (e.g., `013`)
2. Write solution first, then tests
3. Verify: `pnpm -C llm-challenge challenge --problem <id> --use-solution` → must be 100/100

## SDK Improvement Cycle

1. `pnpm -C llm-challenge challenge:solve --retry 3` → analyze failures
2. Improve SDK source (NOT problem descriptions)
3. `pnpm -C packages/sdk build` → `pnpm -C llm-challenge challenge:verify-solution`
4. Re-run benchmark to measure improvement

## Parallel Runs

Reports and per-run work trees are isolated per `(agent, model, context-profile)`, so multiple `pnpm challenge:solve` invocations can run concurrently from separate shells without clobbering each other.

When sweeping multiple context profiles for the same agent/model, launch each in its own background process and wait for all to finish:

```bash
for profile in types-only docs-only tailor-sdk-skill full-package; do
  pnpm -C llm-challenge challenge:solve \
    --agent claude --model opus --retry 3 \
    --context-profile "$profile" \
    > ".agent/tmp/llm-challenge-logs/$profile.log" 2>&1 &
done
wait
```

Caveats:

- Pre-build the SDK once (`pnpm -C packages/sdk build`) before launching parallel runs; concurrent builds race.
- The container image (`llm-challenge-runner`) auto-builds on first use — kick off one solve and let it finish that build, then fan out, or pre-build manually.
- API rate limits apply per credential — running N profiles in parallel multiplies concurrent agent sessions roughly by N.

After parallel runs finish, use `pnpm -C llm-challenge challenge:analyze --groups` to list per-config groups and `--trend --context-profile <profile>` to inspect a single config's history.
