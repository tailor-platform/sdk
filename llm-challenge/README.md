# LLM Challenge

A benchmark system for evaluating whether LLMs can correctly implement @tailor-platform/sdk code. It measures implementation capability across TailorDB models, resolvers, executors, and workflows.

## Problems

| ID  | Name             | Category | Difficulty |
| --- | ---------------- | -------- | ---------- |
| 001 | simple-model     | tailordb | easy       |
| 002 | simple-resolver  | resolver | easy       |
| 010 | related-models   | tailordb | medium     |
| 011 | executor-trigger | executor | medium     |
| 020 | workflow-chain   | workflow | hard       |

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
- `--clean` — Remove work directories after execution

## How Verification Works

Each problem is verified through a 3-stage pipeline. If a stage fails, subsequent stages are skipped.

| Stage         | Points | What it does                                     |
| ------------- | ------ | ------------------------------------------------ |
| **Generate**  | 30     | Runs SDK code generation (`tailor-sdk generate`) |
| **Typecheck** | 20     | Runs TypeScript type checking (`tsc --noEmit`)   |
| **Tests**     | 50     | Runs Vitest unit tests                           |

Each problem is scored out of 100 points. Results are printed as a summary table and saved as JSON to `results/`.

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
