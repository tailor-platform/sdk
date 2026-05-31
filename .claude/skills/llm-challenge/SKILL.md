---
name: llm-challenge
description: Run and maintain the llm-challenge evidence collector for SDK affordance work. Use when the user mentions llm-challenge, challenge runs, challenge results, or creating llm-challenge problems.
metadata:
  internal: true
---

# LLM Challenge

`llm-challenge` records reproducible agent runs against small SDK tasks. Treat it as an evidence collector, not a grader.

## Source Of Truth

- Prefer the current implementation over this guide: inspect `llm-challenge/src/args.ts`, `llm-challenge/src/types.ts`, and `llm-challenge/problems/` before running or changing behavior.
- Do not use or recreate legacy evaluator, scoring, reference-solution, trend, or comparison workflows.
- Do not print or report `PASS`, `FAIL`, scores, or improvement/regression judgments. Report observations and evidence-backed improvement candidates.

## Running A Challenge

Before executing for the user, show one confirmation table and ask for changes or approval. Include a short explanation for each parameter.

Recommended defaults:

- `group`: `all` - problem group to run: `sdk-api`, `cli`, or `all`.
- `profile`: `no-docs` - SDK package profile for `sdk-api`; omit when `group=cli`.
- `runs`: `3` - independent runs per selected problem.
- `concurrency`: same as `runs` - parallel task count.
- `problem filters`: empty - optional `group/id`, bare id, or comma-separated list.
- `sdk-ref`: `HEAD` - SDK git ref to pack.
- `model`: implementation default - Codex model.
- `effort`: implementation default - Codex reasoning effort.
- `output`: implementation default - output directory under `llm-challenge/results/`.
- `max-seconds`: implementation default - per-run timeout.
- `rerun-nonzero-from`: empty - rerun only non-zero or timed-out runs from a prior report.
- `preflight`: enabled - checks the Podman/Codex runner before running.
- `prune-workspace-deps`: enabled - removes per-workspace dependency/cache directories after each run. Pass `--no-prune-workspace-deps` to retain them for debugging.

After confirmation, build the command from the confirmed values:

```bash
pnpm -C llm-challenge challenge run [options]
```

## A/B Testing SDK/API Affordances

When measuring a proposed SDK/API affordance, follow [AB_TESTING.md](AB_TESTING.md).

- Compare an unchanged baseline SDK ref against an after SDK ref committed in the active PR worktree, keeping the same problems, profile, runs, model, effort, timeout, and concurrency.
- Append `success`, `duration`, and `steps` to a temporary JSONL file after every run; append variant and final summaries as separate events.
- Treat usage-limit and other infrastructure-only zero-step runs as invalid for comparison; record them separately and rerun when the limit clears.
- Report a compact table with `success`, average `duration`, and average `steps`.

## Setup

Check setup before the run and complete only the safe, non-interactive steps yourself.

- Run `pnpm install --frozen-lockfile` when dependencies are missing or stale. Do not pipe long-running commands through `tail` or `head`.
- Verify Podman with `podman info`. If unavailable on macOS, ask the user to run `podman machine start` and wait for their result.
- Verify Codex auth by checking the configured auth file, defaulting to `~/.codex/auth.json`. If missing, ask the user to run `codex login` and wait for completion.
- Leave runner verification to the command preflight unless the user explicitly disables it with `--no-preflight`.

## Artifacts

Runs write artifacts under the chosen output directory:

```text
results/<run-id>/
  report.json
  <group>/<problem-id>/run-<n>/
    artifact-summary.json
    verification-summary.json
    verification.stdout.log
    verification.stderr.log
    prompt.md
    solver.stdout.log
    solver.stderr.log
    trace.jsonl
    work/
```

After a run, report the `report.json` path and key artifact paths. Ask whether the user wants artifact analysis.

For analysis, read `report.json`, `artifact-summary.json`, and `verification-summary.json` first. Use summaries to find candidate areas, then inspect `work/`, logs, and `trace.jsonl` before stating conclusions. `artifact-summary.json` includes final file lists, Git status, command history, failed command tails, trace errors, solver exit status, timeout status, and a coarse infrastructure/solver failure kind.

`verification-summary.json` records common and problem-specific minimum correctness checks. Treat these as evidence only: an unsatisfied check means the artifact is missing a required minimum, but satisfied checks do not prove full correctness. Do not report scores, rankings, or `PASS`/`FAIL` labels from verification data.

When reporting solver misconceptions from artifacts, separate SDK usage misconceptions from general development prerequisites. Report an item as an SDK usage misconception only when the evidence shows a wrong assumption about a public `@tailor-platform/sdk` API, configuration schema, generated type contract, documented CLI command, CLI option, plugin hook, service behavior, or SDK-produced artifact path.

Do not include package-manager, workspace, install, cache, offline, network, shell, search, filesystem, permission, process-management, TypeScript/Node.js/ESM/test-runner/build-tool basics, no-docs package layout, private SDK bundle filenames, temporary extraction paths, or verifier false positives in SDK usage misconception reports. If those non-SDK issues repeatedly block solvers, summarize them separately as `llm-challenge` improvement signals. If no SDK usage misconception is present, say that explicitly.

For every reported SDK usage misconception, include the supporting trace log or code evidence and explain the incorrect SDK-specific assumption in one sentence.

Default artifact analysis reports should use tables:

- `SDK usage misconceptions`: columns `Problem`, `SDK-specific mistaken assumption`, and `Evidence`.
- `Non-SDK challenge signals`: columns `Signal`, `Affected problems or evidence`, and `Challenge-side action or status`.

If no SDK usage misconception is present, put that in the first table instead of filling it with non-SDK noise. Include the second table when the user asks about challenge improvements or when non-SDK noise materially affects interpretation.

When the user asks for SDK/API improvement proposals from artifacts, add a separate `SDK/API improvement proposals` section after the misconception and challenge-signal tables. Propose only changes to public SDK APIs, configuration schemas, generated type contracts, CLI commands/options, plugin hooks, or SDK-produced artifact paths; do not propose API changes for package-manager, workspace, install, cache, no-docs package layout, private bundle filenames, test-runner, or other non-SDK issues.

Each SDK/API proposal must be grounded in trace or artifact evidence and distinguish the current correct SDK usage from the observed solver mistake. If using `Before`/`After` wording, `Before` means the current correct SDK/API usage or workaround, not the mistaken solver code; `After` means the proposed public SDK affordance. Prefer a table with columns `Area`, `Evidence`, `Current correct usage`, `Observed mistake`, `Proposed API affordance`, and `Expected effect`. Keep snippets schematic when the exact API design is not settled. State that proposals are API affordance candidates, not verified implementation plans.

## Creating Problems

When creating or revising problems, follow [CREATING_PROBLEMS.md](CREATING_PROBLEMS.md).
