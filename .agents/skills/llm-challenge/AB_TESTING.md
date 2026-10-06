# A/B Testing SDK/API Affordances

Use this workflow when the user asks whether an SDK/API change improves `llm-challenge` outcomes.

## Prepare

- Do not switch the repository root off `main`; keep normal PR work in the active PR worktree.
- For A/B-only changes, create a disposable A/B worktree and commit the after variant there so `--sdk-ref` can pack a stable source. Keep the disposable branch unpushed unless it becomes final PR work, and remove the worktree/branch after the test when it is no longer wanted.
- Choose refs explicitly:
  - `baselineRef`: a clean ref before the affordance, often the parent/base commit.
  - `afterRef`: a commit in the disposable A/B worktree containing the affordance. Do not use an uncommitted worktree as the after source.
- Choose the problem set from the evidence behind the proposal. If several proposals are being tested, run each affected problem against both refs. Keep problem selection identical for baseline and after.
- Keep non-tested variables identical: `agent`, `profile`, `runs`, `concurrency`, `model`, `effort`, `max-seconds`, and solver image.
- Create a temp JSONL summary file before starting, for example `/tmp/sdk-llm-ab-<stamp>.jsonl`.

## Run Variants

Run one variant at a time when usage limits are a risk; otherwise use the same confirmed concurrency for both variants.

```bash
pnpm -C llm-challenge challenge run \
  --problem <group/problem-id> \
  --runs 3 \
  --concurrency 1 \
  --output results/ab-<problem>-baseline-<stamp> \
  --sdk-ref <baselineRef>

pnpm -C llm-challenge challenge run \
  --no-preflight \
  --problem <group/problem-id> \
  --runs 3 \
  --concurrency 1 \
  --output results/ab-<problem>-after-<stamp> \
  --sdk-ref <afterRef>
```

Use `--no-preflight` only after one successful preflight in the same environment. Give each variant a unique output directory.

After both variants finish, grade them together so they share one judge and rubric version. The judge model must differ from the solver model:

```bash
pnpm -C llm-challenge challenge grade \
  --report results/ab-<problem>-baseline-<stamp>/report.json \
  --report results/ab-<problem>-after-<stamp>/report.json \
  --judge-model <model other than the solver's> \
  --output results/ab-<problem>-grades-<stamp>
```

`summary.json` reports each variant under `variants`, keyed by SDK ref.

## Record Progress

After the combined grade finishes, append one JSON object per run to the temp file:

```json
{
  "event": "run",
  "problem": "<id>",
  "variant": "baseline",
  "sdkRef": "<ref>",
  "runIndex": 0,
  "success": true,
  "solverExitCode": 0,
  "timedOut": false,
  "durationSec": 123.4,
  "steps": 56,
  "tracePath": "results/.../trace.jsonl"
}
```

Definitions:

- `success`: the run's `metrics.pass` in the combined `grades.jsonl` (`status` must be `ok`). Do not derive it from exit codes or `verify.json` outcomes.
- `duration`: use `durationMs`/`durationSec` from `report.json`.
- `steps`: the agent's tool-call count. For Claude Code, use `agentResult.toolCalls` from `report.json`. For Codex, count `trace.jsonl` records where `type === "item.completed"`. Command count is narrower and should not replace steps unless the user asks for commands specifically.
- `usageLimitCount`: count runs whose `failureKind` is `usage-limit` (grades mark them `excluded`).

Then append a `variant-summary` per variant and a `final-all-summary`. Summaries should include `runCount`, valid run count, usage-limit count, success count, average duration, and average steps.

## Handle Interrupted Or Limited Runs

- A run stops on its own after a `usage-limit` or `auth` failure. Append an `aborted` event with the reason and leave all already-written run rows intact.
- When limits clear, resume each stopped variant with `--rerun-nonzero-from <its report.json>` and the same `--sdk-ref` and `--profile` into a new output directory, then pass every report of both variants to one `challenge grade`. Runs that a rerun replaced have no `grades.jsonl` row; leave them out of averages.
- Do not hide invalid runs. Keep them in the JSONL with `usageLimitCount` so the user can audit why they were excluded.

## Analyze Artifacts

- Read `report.json` first, then inspect `trace.jsonl`, `verification-summary.json`, and `work/` only as needed.
- For after variants, verify that solvers actually used the new affordance by searching `work/` for the new public API. If adoption is partial, say so.
- Treat a run with `solverExitCode = 0` but `success = false` as an unsuccessful run; read its failing claims in `grade.json` and the verification artifacts before explaining why.
- Keep SDK/API conclusions separate from challenge-side or infrastructure issues.

## Report

Report a table with one row per problem/proposal:

```text
Problem | Baseline success, avg duration, avg steps | After success, avg duration, avg steps | Delta
```

Use deltas for success count, duration seconds, and steps.

Include A/B-specific context needed to interpret the table: baseline/after refs, the judge model, each variant's pass-rate confidence interval from `variants` in the grade summary, the `steps` counting rule, excluded and error runs, and partial adoption of the tested API. Call a difference an improvement or regression only when the intervals do not overlap; otherwise report it as inconclusive at this run count.
