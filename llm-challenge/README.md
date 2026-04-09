# LLM Challenge

A benchmark for measuring how AI-friendly `@tailor-platform/sdk` is. LLMs solve implementation problems across TailorDB models, resolvers, executors, and workflows — when they fail, it signals that the SDK lacks sufficient information or isn't AI-friendly enough, rather than a limitation of the AI itself.

## Improvement Philosophy

When an AI fails a challenge problem, the correct response is to **improve the SDK itself**, not to add hints to the problem description. This means:

- Adding JSDoc comments and `@example` blocks to SDK types and functions
- Improving error messages in SDK validation and code generation
- Enriching `CLAUDE.md` patterns and type references
- Making APIs more discoverable through better type signatures

SDK improvement proposals based on benchmark results are tracked in [`.claude/IMPROVEMENTS.md`](../.claude/IMPROVEMENTS.md).

## Problems

| ID  | Name                       | Category    | Difficulty | Scoring (G/T/Te) | Total |
| --- | -------------------------- | ----------- | ---------- | ---------------- | ----- |
| 001 | saas-subscription-platform | integration | hard       | 30 / 30 / 240    | 300   |

**Scoring column**: Generate / Typecheck / Tests

- **001**: Full-stack integration covering TailorDB models (5 types), resolvers, executors, workflows, and application config. Uses `db.type()` fluent API.

## Prerequisites

Build the SDK before running challenges:

```bash
pnpm -C packages/sdk build
```

## Commands

```bash
# Verify all problems using reference solutions
pnpm challenge:verify-solution

# Run runner unit tests (adapter/parser logic)
pnpm test:runner

# Solve all problems using Claude Code (default)
pnpm challenge:solve [--agent claude] [--model sonnet] [--max-budget 5.00]

# Solve all problems using Codex
pnpm challenge:solve --agent codex [--model gpt-5-codex]

# Solve with retry on failure
pnpm challenge:solve --retry 2 [--agent claude|codex] [--model sonnet] [--max-budget 5.00]

# Run a single problem
pnpm challenge --problem 001 --use-solution
pnpm challenge --problem 001 --impl ./path/to/impl
pnpm challenge --problem 001 --solve [--agent claude|codex]

# Run all problems with external implementations
pnpm challenge --all --impl-dir ./path/to/outputs
```

**Flags:**

- `--agent <claude|codex>` — Solver agent to use (default: `claude`)
- `--model <name>` — Model name to use (`claude`: default `sonnet`, `codex`: default CLI model)
- `--max-budget <usd>` — Spending cap per problem in USD (default: `5.00`, must be positive)
- `--retry <n>` — Number of retry attempts on failure (default: `0`, must be non-negative). On failure, error output is fed back to the AI for correction.
- `--concurrency <n>` — Number of problems to run in parallel (default: CPU count, must be positive)
- `--clean` — Remove work directories after execution

## How Verification Works

Each problem is verified through a 3-stage pipeline. If a stage fails, subsequent stages are skipped.

| Stage         | Points | What it does                                     |
| ------------- | ------ | ------------------------------------------------ |
| **Generate**  | varies | Runs SDK code generation (`tailor-sdk generate`) |
| **Typecheck** | varies | Runs TypeScript type checking (`tsc --noEmit`)   |
| **Tests**     | varies | Runs Vitest unit tests                           |

Each problem's scoring weights are defined in its `meta.json`.

### Partial Scoring

Both the generate and tests stages support partial scoring. If some checks pass but not all, the score is proportionally calculated:

```
stage_score = round((checks_passed / checks_total) * max_stage_points)
```

For the generate stage, partial scoring considers:

- File existence (20% of generate score)
- File import check (60% of generate score)
- Full generation success (100%)

### Weighted Scoring

Problems are weighted by difficulty for the weighted score:

| Difficulty | Weight |
| ---------- | ------ |
| easy       | 1.0x   |
| medium     | 1.5x   |
| hard       | 2.5x   |

### Failure Categories

When a stage fails, the output is automatically classified into a failure category:

| Category         | Description                                 |
| ---------------- | ------------------------------------------- |
| `missing_file`   | File does not exist or ENOENT error         |
| `import_error`   | Cannot find module or missing export        |
| `type_error`     | TypeScript compilation error (TS codes)     |
| `generate_error` | SDK code generation failed                  |
| `logic_error`    | Test failures (default for test stage)      |
| `api_misuse`     | SDK API validation errors during generation |

Skipped stages (due to earlier stage failure) are not classified.

### Retry Mode

When using `--retry N`, failed problems are automatically retried:

1. Initial solve attempt runs normally
2. If verification fails, error output from failed stages (with `[STAGE: ...]` labels) is sent back to the AI
3. The AI receives a prompt like: "Your previous implementation produced the following error: ... Fix the issues."
4. Re-verification runs after each retry
5. Stops on success or after N retries

A retry penalty is applied: `adjusted_score = base_score * (1 - 0.1 * retry_count)`, with a maximum 30% reduction.

Cost from all attempts (initial + retries) is tracked in the report.

### Report Metadata

JSON reports include metadata for comparison tracking:

- `model` — Claude model used (when solving)
- `sdkVersion` — SDK package version
- `timestamp` — When the run was executed

Results are printed as a summary table and saved as JSON to `results/`.

### Analytics

Reports include analytics for identifying SDK improvement areas:

- **Failure distribution** — Count of each failure category
- **Category/difficulty/stage success rates** — Pass rates by grouping
- **Common failure patterns** — Recurring failure category + stage combinations with suggested documentation fixes
- **Retry analysis** — Which failure categories are self-correctable vs persistent

## Problem Structure

```
problems/<id>-<name>/
├── meta.json      # Metadata (difficulty, scoring, files to implement)
├── problem.md     # Problem description
├── scaffold/      # Starter files (tailor.config.ts, etc.)
├── solution/      # Reference implementation
├── tests/         # Vitest test suite
└── work/          # Generated at runtime (not committed)
```
