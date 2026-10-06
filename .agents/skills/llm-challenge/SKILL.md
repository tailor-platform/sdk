---
name: llm-challenge
description: Run, grade, and maintain the llm-challenge harness for SDK affordance work. Use when the user mentions llm-challenge, challenge runs, challenge grades or results, or creating llm-challenge problems.
metadata:
  internal: true
---

# LLM Challenge

`llm-challenge` records reproducible agent runs against small SDK tasks (`challenge run`) and grades them separately (`challenge grade`).

## Source Of Truth

- Prefer the current implementation over this guide: inspect `llm-challenge/src/args.ts`, `llm-challenge/src/grade.ts`, `llm-challenge/src/types.ts`, and `llm-challenge/problems/` before running or changing behavior.
- Scores come only from `challenge grade` output. Do not derive pass/fail or scores from `verify.json` outcomes, exit codes, or your own reading of artifacts, and do not recreate the removed reference-solution, trend, or point-based scoring workflows.
- Report improvement or regression only from a comparison graded by one `challenge grade` invocation (one judge, one rubric version), and only when the difference exceeds the reported confidence intervals. Otherwise report it as inconclusive.

## Running A Challenge

Before executing for the user, show one confirmation table and ask for changes or approval. Include a short explanation for each parameter.

Recommended defaults:

- `agent`: `claude` - solver: `claude` (Claude Code) or `codex`.
- `group`: `all` - problem group to run: `sdk-api`, `cli`, or `all`.
- `profile`: `no-docs` - SDK package profile for `sdk-api`; omit when `group=cli`.
- `runs`: `3` - independent runs per selected problem.
- `concurrency`: same as `runs` - parallel task count.
- `problem filters`: empty - optional `group/id`, bare id, or comma-separated list.
- `sdk-ref`: `HEAD` - SDK git ref to pack.
- `model`: implementation default for the agent (`claude-opus-5-5` for Claude Code, `gpt-5.5` for Codex).
- `effort`: implementation default for the agent (`xhigh`).
- `output`: implementation default - output directory under `llm-challenge/results/`.
- `max-seconds`: implementation default - per-run timeout.
- `rerun-nonzero-from`: empty - rerun non-zero, timed-out, and infrastructure-failed runs, plus runs that never started, from a prior report with that report's agent, model, and effort.
- `preflight`: enabled - checks the Podman runner; for Claude Code it also checks the pinned CLI version and makes one model call.
- `prune-workspace-deps`: enabled - removes per-workspace dependency/cache directories after each run. Pass `--no-prune-workspace-deps` to retain them for debugging.

After confirmation, build the command from the confirmed values:

```bash
pnpm -C llm-challenge challenge run [options]
```

A run stops scheduling new tasks after a `usage-limit` or `auth` failure. Once the cause is resolved, `--rerun-nonzero-from <report.json>` reruns the failed run and the runs that never started.

## Grading Runs

Grade one or more reports in a single invocation so every run shares the same judge and rubric version:

```bash
pnpm -C llm-challenge challenge grade --report results/<run-id>/report.json [--report <another report.json>] [options]
```

- `judge-model`: `claude-opus-5-5`. The judge must not be the solver model; grading Claude Opus runs needs another `--judge-model` (for example `claude-fable-5-1`) for every report in the comparison. `--allow-self-judge` overrides the check.
- `judge-effort`: `high`.
- `concurrency`: `1`; the Podman VM's memory bounds this.
- `output`: `results/<run-id>/grades/<grade-id>/` next to the first report.

The judge runs Claude Code in the same pinned container with only `Read`, `Glob`, and `Grep`, on a copy of the workspace without agent configuration (`.claude/`, `CLAUDE.md`, `.mcp.json`), symlinks, or dependency caches, plus `/evidence/commands.json` with the solver's command history. It returns one verdict per hidden rubric claim; a `satisfied` verdict counts only when one of its quoted excerpts exists in the cited file.

A run passes when the solver finished normally, no common check (package.json, tailor.config.ts, TypeScript) is `unsatisfied`, and every rubric claim counts as satisfied. Problem `verify.json` outcomes are recorded but do not gate the pass. Runs with infrastructure failures (`timeout`, `usage-limit`, `auth`, `model-mismatch`, `runner-startup`, `unknown`) are `excluded`; common-check verifier errors and judge failures are `error`; neither counts toward pass rates.

Outputs: `summary.json` (judge model and CLI version, prompt version, rubric hashes, source reports, per-problem and overall results, and `variants` with the same results per solver configuration: agent, model, effort, profile, and SDK ref, so a rerun report joins its source), `grades.jsonl` (one row per run, with its source report), and `runs/<run-id>/<group>/<id>/run-<n>/` with the judge prompt, trace, workspace copy, and `grade.json`.

Report the overall pass rate with its 95% confidence interval (a cluster bootstrap over problems and runs), or each variant's when the grade compares configurations, the per-problem passes, and the excluded and error counts. Read failing claims' reasons and evidence before explaining a result, and spot-check a few graded runs yourself before trusting a new rubric.

## A/B Testing SDK/API Affordances

When measuring a proposed SDK/API affordance, follow [AB_TESTING.md](AB_TESTING.md).

- Compare an unchanged baseline SDK ref against an after SDK ref committed in a disposable A/B worktree, keeping the same agent, problems, profile, runs, model, effort, timeout, and concurrency.
- Grade both variants in one `challenge grade` invocation.
- Report a compact table with pass rate and confidence interval, average `duration`, and average `steps` per variant.

## Setup

Check setup before the run and complete only the safe, non-interactive steps yourself.

- Run `pnpm install --frozen-lockfile` when dependencies are missing or stale. Do not pipe long-running commands through `tail` or `head`.
- Verify Podman with `podman info`. If the machine is stopped on macOS, run `podman machine start`.
- Claude Code (solver and judge) reads `CLAUDE_CODE_OAUTH_TOKEN`, or the token file at `LLM_CHALLENGE_CLAUDE_OAUTH_TOKEN_FILE` (default `~/.config/llm-challenge/claude-oauth-token`). If neither exists, ask the user to run `claude setup-token` in their own terminal and save the token to that file with owner-only permissions; never ask them to paste it into the conversation. The token is passed to containers by environment variable name and redacted from solver and judge logs and from solver workspace files. The solver runs without web tools or tools that act on the Claude account (remote triggers, cron, messaging, workflows).
- Codex reads the configured auth file, defaulting to `~/.codex/auth.json`. If missing, ask the user to run `codex login` and wait for completion.
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

For analysis, read `report.json`, `artifact-summary.json`, and `verification-summary.json` first, and the grade output when the run was graded. Use summaries to find candidate areas, then inspect `work/`, logs, and `trace.jsonl` before stating conclusions. `artifact-summary.json` includes final file lists, Git status, command history, failed command tails, trace errors, solver exit status, timeout status, a failure kind, and for Claude Code the tool-call count, served models, turns, and cost estimate.

`verification-summary.json` records common and problem-specific minimum correctness checks. Treat these as evidence only: an unsatisfied check means the artifact is missing a required minimum, but satisfied checks do not prove full correctness. Do not report scores, rankings, or pass/fail labels from verification data; use `challenge grade` for those.

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
