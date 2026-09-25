# A/B Testing SDK/API Affordances

Use this workflow when the user asks whether an SDK/API change improves `llm-challenge` outcomes.

## Prepare

- Do not switch the repository root off `main`; keep normal PR work in the active PR worktree.
- For A/B-only changes, create a disposable A/B worktree and commit the after variant there so `--sdk-ref` can pack a stable source. Keep the disposable branch unpushed unless it becomes final PR work, and remove the worktree/branch after the test when it is no longer wanted.
- Choose refs explicitly:
  - `baselineRef`: a clean ref before the affordance, often the parent/base commit.
  - `afterRef`: a commit in the disposable A/B worktree containing the affordance. Do not use an uncommitted worktree as the after source.
- Choose the problem set from the evidence behind the proposal. If several proposals are being tested, run each affected problem against both refs. Keep problem selection identical for baseline and after.
- Keep non-tested variables identical: `profile`, `runs`, `concurrency`, `model`, `effort`, `max-seconds`, and solver image.
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

## Record Progress

After each run completes, append one JSON object to the temp file:

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

- `success`: a derived pass/fail for the run, not a score label. `report.json` has no `success` field — compute it per run: successful when the solver completed (`solverExitCode = 0` and `timedOut = false` in `report.json`) **and** no check in that run's `verification-summary.json` has `outcome` of `unsatisfied` or `error`. This is why a run can have `solverExitCode = 0` yet `success = false`.
- `duration`: use `durationMs`/`durationSec` from `report.json`.
- `steps`: count `trace.jsonl` records where `type === "item.completed"`. This is the agent interaction/action count. Command count is narrower and should not replace steps unless the user asks for commands specifically.
- `usageLimitCount`: count runs that failed before meaningful agent work, usually non-zero solver exit, very short duration, and `steps = 0` with usage-limit evidence in solver logs or trace.

Append a `variant-summary` after each variant and a `final-all-summary` after all variants. Summaries should include `runCount`, valid run count, usage-limit count, success count, average duration, and average steps.

## Handle Interrupted Or Limited Runs

- If usage limits appear, stop after repeated zero-step failures. Append an `aborted` event with the reason and leave all already-written run rows intact.
- When limits clear, resume into new output directories with a new output stamp. In final comparison, prefer the resumed complete summaries and exclude earlier usage-limit rows from averages.
- Do not hide invalid runs. Keep them in the JSONL with `usageLimitCount` so the user can audit why they were excluded.

## Analyze Artifacts

- Read `report.json` first, then inspect `trace.jsonl`, `verification-summary.json`, and `work/` only as needed.
- For after variants, verify that solvers actually used the new affordance by searching `work/` for the new public API. If adoption is partial, say so.
- Treat a run with `solverExitCode = 0` but `success = false` as an unsuccessful run; inspect verification artifacts before explaining why.
- Keep SDK/API conclusions separate from challenge-side or infrastructure issues.

## Report

Report a table with one row per problem/proposal:

```text
Problem | Baseline success, avg duration, avg steps | After success, avg duration, avg steps | Delta
```

Use deltas for success count, duration seconds, and steps.

Include A/B-specific context needed to interpret the table: baseline/after refs, the `steps` counting rule, usage-limit exclusions, and partial adoption of the tested API.
