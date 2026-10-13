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
- `runtime`: `podman` - where the solver runs: `podman` (a container) or `host` (Claude Code on this machine, `claude` agent only, macOS only, not with `install-skills`). See "Host Runtime".
- `install-skills`: disabled - copy the SDK's agent skills into each workspace's `.claude/skills/` and `.agents/skills/`, as `tailor skills add` does, so the solver can load them; requires `profile: full` for `sdk-api`. Runs record the skills the solver saw and invoked (`agentResult.availableSkills`, `agentResult.skillInvocations`), and grades keep runs with and without skills in separate variants.
- `runs`: `3` - independent runs per selected problem.
- `concurrency`: same as `runs` - parallel task count.
- `problem filters`: empty - optional `group/id`, bare id, or comma-separated list.
- `sdk-ref`: `HEAD` - SDK git ref to pack.
- `model`: implementation default for the agent (`claude-opus-5-5` for Claude Code, `gpt-5.5` for Codex).
- `effort`: implementation default for the agent (`xhigh`).
- `output`: implementation default - output directory under `llm-challenge/results/`.
- `max-seconds`: implementation default - per-run timeout.
- `rerun-nonzero-from`: empty - rerun the runs a prior report could not score (infrastructure failures, including timeouts, or non-zero exits in reports without a failure kind) plus runs that never started, with that report's agent, model, and effort. Scored failures are not rerun, so reruns cannot replace them in grades. It does not inherit `sdk-ref`, `profile`, or `max-seconds`; pass the source run's values again.
- `preflight`: enabled - checks the Podman runner; for Claude Code it also installs the pinned CLI into `llm-challenge/.cache/claude-code/` (the only step that writes there; solver and judge containers mount it read-only), checks its version, and makes one model call. `--no-preflight` requires that install to exist.
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

- `judge-model`: `claude-fable-5-1`, which differs from the default Claude solver model. The judge must not be the solver model; grading Claude Fable runs needs another `--judge-model` (for example `claude-opus-5-5`) for every report in the comparison. `--allow-self-judge` overrides the check.
- `judge-effort`: `high`.
- `runtime`: `podman` - where the judge runs: `podman` or `host` (see "Host Runtime"); `summary.json` records it under `judge.runtime`.
- `concurrency`: `1`; with Podman the VM's memory bounds this, and on the host the machine's memory does.
- `output`: `results/<run-id>/grades/<grade-id>/` next to the first report.

The judge runs Claude Code in the same pinned container with only `Read`, `Glob`, and `Grep`, on a copy of the workspace without agent configuration (`.claude/`, `CLAUDE.md`, `.mcp.json`), symlinks, or dependency caches, plus `/evidence/commands.json` with the solver's command history. It returns one verdict per hidden rubric claim; a `satisfied` verdict counts only when one of its quoted excerpts (at least 12 characters) exists in the cited file. Command-history quotes come from text the solver produced, so CLI claims verified only through `/evidence/commands.json` trust that output.

A run passes when the solver finished normally, no common check (package.json, tailor.config.ts, TypeScript) is `unsatisfied`, and every rubric claim counts as satisfied. Problem `verify.json` outcomes are recorded but do not gate the pass. Runs with infrastructure failures (`timeout`, `usage-limit`, `auth`, `model-mismatch`, `api-error`, `runner-startup`, `killed`, `unknown`) are `excluded`; common-check verifier errors and judge failures are `error`; neither counts toward pass rates. A problem whose runs are all excluded or errored drops out of the pass-rate denominator, so a variant that times out on a problem can look better; read `excludedByReason` and `unscoredProblems` in `summary.json` (printed after the pass rate) before comparing variants.

Outputs: `summary.json` (judge model and CLI version, prompt version, rubric hashes, source reports, per-problem and overall results, and `variants` with the same results per solver configuration: agent, model, effort, profile, and SDK ref, so a rerun report with the same SDK ref and profile joins its source), `grades.jsonl` (one row per run, with its source report), and `runs/<run-id>/<group>/<id>/run-<n>/` with the judge prompt, trace, workspace copy, and `grade.json`.

Report the overall pass rate with its 95% confidence interval (a cluster bootstrap over problems and runs), or each variant's when the grade compares configurations, the per-problem passes, and the excluded and error counts. Read failing claims' reasons and evidence before explaining a result, and spot-check a few graded runs yourself before trusting a new rubric.

## A/B Testing SDK/API Affordances

When measuring a proposed SDK/API affordance, follow [AB_TESTING.md](AB_TESTING.md).

- Compare an unchanged baseline SDK ref against an after SDK ref committed in a disposable A/B worktree, keeping the same agent, problems, profile, runs, model, effort, timeout, and concurrency.
- Grade both variants in one `challenge grade` invocation.
- Report a compact table with pass rate and confidence interval, average `duration`, and average `steps` per variant.

## Setup

Check setup before the run and complete only the safe, non-interactive steps yourself.

- Run `pnpm install --frozen-lockfile` when dependencies are missing or stale. Do not pipe long-running commands through `tail` or `head`.
- Verify Podman with `podman info` unless the run uses `--runtime host`. If the machine is stopped on macOS, run `podman machine start`.
- Claude Code (solver and judge) reads `CLAUDE_CODE_OAUTH_TOKEN`, or the token file at `LLM_CHALLENGE_CLAUDE_OAUTH_TOKEN_FILE` (default `~/.config/llm-challenge/claude-oauth-token`). If neither exists, ask the user to run `claude setup-token` in their own terminal and save the token to that file with owner-only permissions; never ask them to paste it into the conversation. The token is passed to containers by environment variable name. Treat it as readable by the solver: in a measurement with Claude Code 2.1.296, a shell command run by the solver printed an arbitrary variable set on the `claude` process, and `CLAUDE_CODE_OAUTH_TOKEN` itself was not measured because that needs a real token. It is redacted from solver and judge logs and from solver workspace files (a file over 10 MiB that contains it is deleted, since it is too large to rewrite), except under `.git` and the dependency and cache directories that `--prune-workspace-deps` removes after each run; a solver that deliberately commits it would leave it in `work/.git`. `--runtime host` does not use a token. The solver runs without web tools or tools that act on the Claude account (remote triggers, cron, messaging, workflows).
- Codex reads the configured auth file, defaulting to `~/.codex/auth.json`. If missing, ask the user to run `codex login` and wait for completion.
- Leave runner verification to the command preflight unless the user explicitly disables it with `--no-preflight`.

## Host Runtime

`--runtime host` runs the pinned Claude Code (installed into `llm-challenge/.cache/claude-code/`, checked by preflight like the Podman runtime) on this machine instead of in a container. It uses the host's own Claude Code login, so no OAuth token is set anywhere, and `--safe-mode` keeps the user's `CLAUDE.md`, skills, hooks and MCP servers out. The same options apply to `challenge grade --runtime host` for the judge. Reports record `runner.kind`, and a grade keeps host and Podman runs apart as separate variants.

It is weaker than Podman. Use it for local work you trust, and read these limits before comparing it with a Podman run:

- File tools (Read, Edit) are limited to the worktree by permission rules, with no `bypassPermissions`. Shell commands run in Claude Code's sandbox: they can write only inside the worktree and the shared pnpm store, cannot read the repository (problems, rubrics, other runs) or credential paths such as `~/.ssh`, `~/.config`, `~/.claude` and shell history, and have no network access, because any allowed host (the package registry included) is a way for a prompt-injected solver to send out what it can read. Anything else on the machine that is not in that hidden list stays readable. The solver cannot install packages that were not installed before it started.
- A measurement showed Read, Write and Grep/Glob are outside the sandbox when permissions are bypassed, and that allowing `Glob` or `Grep` on their own lists directories outside the worktree. The runtime therefore allows only `Read` and `Edit` on the worktree. The sandbox hides the macOS Keychain from shell commands.
- The sandbox always refuses writes to paths such as `.vscode`, so a solver's `pnpm install` fails on packages that ship them. The harness runs `pnpm install --ignore-scripts` in the worktree before each solver starts, outside the sandbox and with network access; dependency lifecycle scripts do not run.
- The environment is an allowlist (PATH, HOME, locale and similar), so tokens in the parent shell do not reach the solver. A timeout signals the whole process group.
- The TypeScript check runs the repository's trusted compiler under `sandbox-exec` with writes forbidden and the same hidden paths, with `--incremental false --composite false`; it has no network, memory or process limits. Because of `sandbox-exec`, `--runtime host` needs macOS.
- The judge keeps its `dontAsk` mode and `Read`, `Glob` and `Grep` tools, which a measurement showed cannot read outside the workspace and evidence directories.

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
