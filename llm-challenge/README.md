# LLM Challenge

A benchmark system for evaluating whether LLMs can correctly implement @tailor-platform/sdk code. It measures implementation capability across TailorDB models, resolvers, executors, and workflows.

## Problems

| ID  | Name                    | Category | Difficulty |
| --- | ----------------------- | -------- | ---------- |
| 001 | simple-model            | tailordb | easy       |
| 002 | simple-resolver         | resolver | easy       |
| 003 | mutation-resolver       | resolver | easy       |
| 004 | datetime-model          | tailordb | easy       |
| 005 | array-resolver          | resolver | easy       |
| 006 | db-access-resolver      | resolver | easy       |
| 010 | related-models          | tailordb | medium     |
| 011 | executor-trigger        | executor | medium     |
| 012 | executor-update-trigger | executor | medium     |
| 013 | nested-model            | tailordb | medium     |
| 014 | hooks-serial-model      | tailordb | medium     |
| 015 | features-indexes        | tailordb | medium     |
| 016 | schedule-executor       | executor | medium     |
| 017 | webhook-executor        | executor | medium     |
| 018 | deleted-trigger         | executor | medium     |
| 020 | workflow-chain          | workflow | hard       |
| 021 | full-config             | config   | hard       |
| 022 | model-permissions       | tailordb | hard       |
| 023 | nested-input-resolver   | resolver | hard       |
| 030 | fix-broken-model        | tailordb | medium     |

## Prerequisites

Build the SDK before running challenges:

```bash
pnpm -C packages/sdk build
```

## Commands

```bash
# Verify all problems using reference solutions
pnpm challenge:verify-solution

# Solve all problems using Claude Code
pnpm challenge:solve [--model sonnet] [--max-budget 2.00]

# Solve with retry on failure
pnpm challenge:solve --retry 2 [--model sonnet] [--max-budget 2.00]

# Run a single problem
pnpm challenge --problem 001 --use-solution
pnpm challenge --problem 001 --impl ./path/to/impl
pnpm challenge --problem 001 --solve

# Run all problems with external implementations
pnpm challenge --all --impl-dir ./path/to/outputs
```

**Flags:**

- `--model <name>` — Claude model to use (default: `sonnet`)
- `--max-budget <usd>` — Spending cap per problem in USD (default: `2.00`)
- `--retry <n>` — Number of retry attempts on failure (default: `0`). On failure, error output is fed back to the AI for correction.
- `--clean` — Remove work directories after execution

## How Verification Works

Each problem is verified through a 3-stage pipeline. If a stage fails, subsequent stages are skipped.

| Stage         | Points | What it does                                     |
| ------------- | ------ | ------------------------------------------------ |
| **Generate**  | varies | Runs SDK code generation (`tailor-sdk generate`) |
| **Typecheck** | varies | Runs TypeScript type checking (`tsc --noEmit`)   |
| **Tests**     | varies | Runs Vitest unit tests                           |

Each problem is scored out of 100 points. The scoring weights vary by problem type:

- **Resolver body problems** (002, 003, 005, 006, 023): Generate 20, Typecheck 10, Tests 70
- **Config problems** (021): Generate 50, Typecheck 20, Tests 30
- **Other problems**: Generate 30, Typecheck 20, Tests 50

### Partial Scoring

The tests stage supports partial scoring. If some tests pass but not all, the score is proportionally calculated:

```
test_score = round((tests_passed / tests_total) * max_test_points)
```

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

### Retry Mode

When using `--retry N`, failed problems are automatically retried:

1. Initial solve attempt runs normally
2. If verification fails, error output from failed stages is sent back to the AI
3. The AI receives a prompt like: "Your previous implementation produced the following error: ... Fix the issues."
4. Re-verification runs after each retry
5. Stops on success or after N retries

Cost from all attempts (initial + retries) is tracked in the report.

### Report Metadata

JSON reports include metadata for comparison tracking:

- `model` — Claude model used (when solving)
- `sdkVersion` — SDK package version
- `timestamp` — When the run was executed

Results are printed as a summary table and saved as JSON to `results/`.

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
