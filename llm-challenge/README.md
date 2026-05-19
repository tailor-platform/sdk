# LLM Challenge

A benchmark for measuring how AI-friendly `@tailor-platform/sdk` is. LLMs solve implementation problems across TailorDB models, resolvers, executors, and workflows — when they fail, it signals that the SDK lacks sufficient information or isn't AI-friendly enough, rather than a limitation of the AI itself.

## Improvement Philosophy

When an AI fails a challenge problem, the correct response is to **improve the SDK itself**, not to add hints to the problem description. This means:

- Adding JSDoc comments and `@example` blocks to SDK types and functions
- Improving error messages in SDK validation and code generation
- Enriching `CLAUDE.md` patterns and type references
- Making APIs more discoverable through better type signatures

A passing verify run is not the only signal. The trace tool (see below) reports false starts (repeated `Write` to the same file in a single session). High false-start counts indicate the SDK is hard to use even when the final output works.

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

## Workflow

The runner does not invoke an AI agent. Solving is manual or delegated to a sub-agent; the runner only prepares workspaces, scores implementations, and extracts session traces.

```bash
# 1. Prepare a clean workspace and prompt for one problem
pnpm challenge --problem 001 --prepare
# → prints: workDir, .prompt.md path, and a `cd <workDir> && claude` hint

# 2. Solve manually (`cd <workDir> && claude`) or via a sub-agent with cwd=<workDir>

# 3. Extract trace from the Claude Code session JSONL (manual solve only)
pnpm challenge:trace --workdir <workDir>
# → results/trace-<label>-<ts>.json

# 4. Grade the implementation
pnpm challenge --problem 001 --impl <workDir>
# → results/report-<ts>.json
```

## Commands

```bash
# Verify all problems using reference solutions (CI sanity check)
pnpm challenge:verify-solution

# Prepare a workspace for a single problem
pnpm challenge --problem 001 --prepare

# Run a single problem against a reference solution
pnpm challenge --problem 001 --use-solution

# Run a single problem against an implementation directory
pnpm challenge --problem 001 --impl ./path/to/impl

# Run all problems against external implementations
pnpm challenge --all --impl-dir ./path/to/outputs

# Extract a Claude Code session trace (false-start metrics)
pnpm challenge:trace --workdir <dir> [--session <uuid>] [--problem <id>] [--out <path>]

# Compare or trend reports under results/
pnpm challenge:analyze
pnpm challenge:analyze --baseline results/report-<ts>.json
pnpm challenge:analyze --trend

# Run runner unit tests (parser logic for trace.ts and friends)
pnpm test:runner
```

**Flags (`challenge`):**

- `--problem <id>` — Run a single problem
- `--all` — Run every problem
- `--prepare` — Create an isolated workDir + install dependencies + write `.prompt.md`, then exit (no scoring)
- `--use-solution` — Use the problem's reference solution as the implementation
- `--impl <dir>` — Use the given directory as the implementation for a single problem
- `--impl-dir <dir>` — With `--all`, look up implementations by problem name under this directory
- `--concurrency <n>` — Number of problems to run in parallel (default: CPU count)
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

### Report Metadata

JSON reports include metadata for comparison tracking:

- `sdkVersion` — SDK package version
- `timestamp` — When the run was executed
- `elapsedMs` — Wall time for the run

Results are printed as a summary table and saved as JSON to `results/`.

### Analytics

Reports include analytics for identifying SDK improvement areas:

- **Failure distribution** — Count of each failure category
- **Category/difficulty/stage success rates** — Pass rates by grouping
- **Common failure patterns** — Recurring failure category + stage combinations with suggested documentation fixes

## Trace Output

`pnpm challenge:trace --workdir <dir>` parses `~/.claude/projects/<encoded>/<session>.jsonl` and writes `results/trace-<label>-<ts>.json` containing:

| Field                     | Description                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| `durationMs`              | Session wall time (first → last event)                                 |
| `files[]`                 | Per-file `Write` history; non-final successful writes are false starts |
| `files[].writes[]`        | `{ts, toolUseId, contentLength, isFalseStart, diffSummary?}`           |
| `files[].falseStartCount` | Count of false starts for that file                                    |
| `falseStartTotal`         | Sum across all files                                                   |
| `edits[]`                 | `Edit` / `MultiEdit` invocations                                       |
| `bashCommands[]`          | `Bash` invocations with command + description                          |
| `readPaths[]`             | `Read` invocations                                                     |
| `assistantTextLength`     | Total characters of assistant text output                              |

Errored `Write` calls (`is_error: true` in `tool_result`) are dropped before false-start counting. Trace works for the manual solve path (where `claude` writes a JSONL session under `~/.claude/projects/`); delegated sub-agent runs do not produce a session file.

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
