---
name: llm-challenge
description: >
  Manage the LLM Challenge benchmark: prepare workspaces, score implementations,
  collect Claude Code session traces, and improve the SDK based on failures.
  Use when user mentions "llm-challenge", "challenge", "benchmark", or "lc".
metadata:
  internal: true
---

# LLM Challenge

Benchmark for `@tailor-platform/sdk` AI-friendliness. Located at `llm-challenge/`.

Read `llm-challenge/README.md` for commands, scoring, and verification details.

## Core Rule

When AI fails a challenge, **improve the SDK** (JSDoc, error messages, types, CLAUDE.md) — NEVER add hints to `problem.md`.

A passing verify run is not enough. If the session trace shows many false starts (repeated `Write` to the same file), the SDK's AI ergonomics are still lacking. Treat the `falseStartTotal` metric and per-file write counts as a signal for SDK improvement just like verify failures.

## Prerequisites

- ALWAYS build SDK before running: `pnpm -C packages/sdk build`
- ALWAYS run `pnpm install` before benchmarks (stale dependencies break the verify pipeline)

## Problem Conventions

Structure: `problems/<id>-<name>/` with `meta.json`, `problem.md`, `scaffold/`, `solution/`, `tests/`

**meta.json rules**:

- `id`: 3-digit zero-padded, sequential
- `scoring`: Category defaults — tailordb: 20/20/60, resolver/executor/workflow: 15/15/70, config: 30/20/50, fix-broken: 15/15/70
- Fix-broken problem: same file appears in both `implement` and `scaffold`

**problem.md rules**:

- Sections: Goal → Domain Context/Instructions → What to Build → Requirements → Reference
- NEVER include SDK code examples — AI must discover the API from the installed SDK package itself
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

The runner no longer auto-invokes an agent. Solving is done manually or via a sub-agent; the runner only prepares the workspace, scores implementations, and extracts traces.

1. **Prepare** — `pnpm -C llm-challenge challenge --problem <id> --prepare`
   - Creates an isolated `mkdtemp` workDir, installs the local SDK via `link:`, and writes `<workDir>/.prompt.md`.
   - Note the printed `workDir`.
2. **Solve** — pick one:
   - **Manual**: in another terminal, `cd <workDir> && claude`, then implement against `.prompt.md`.
   - **Delegated**: launch a sub-agent (`Agent` tool, `general-purpose`) with `cwd: <workDir>`, tool allowlist `Read,Write,Edit,Bash(pnpm:*)`, and the prompt body taken from `<workDir>/.prompt.md`.
3. **Trace** — `pnpm -C llm-challenge challenge:trace --workdir <workDir>`
   - Parses `~/.claude/projects/<encoded>/<session>.jsonl` and writes `results/trace-*.json` with `falseStartTotal`, per-file write history, edits, bash, reads, and `durationMs`.
   - Sub-agent runs do not produce a JSONL session log; the trace step is only meaningful for the manual path.
4. **Grade** — `pnpm -C llm-challenge challenge --problem <id> --impl <workDir>`
   - Scores using the 3-stage verify pipeline; emits `results/report-*.json`.
5. **Improve** — use both the verify report and the trace to find SDK weaknesses; change SDK source (NOT problem descriptions); `pnpm -C packages/sdk build`; rerun from step 1.
