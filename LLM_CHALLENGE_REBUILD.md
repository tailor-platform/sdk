# LLM Challenge Rebuild Brief

This document is the starting point for rebuilding `llm-challenge` from an empty directory. Do not restore or inspect the deleted implementation while implementing the new version; treat this as the source of truth.

## Purpose

`llm-challenge` is an evidence collector for SDK affordance work. It runs an AI agent against small SDK project tasks and stores the resulting artifacts so a human can evaluate whether the SDK design, documentation, and CLI are understandable.

The tool must not auto-grade solutions. It must not classify mistakes. It must not report pass rates. Its job is to make the AI run reproducible and easy to inspect.

## Non-Goals

- No automatic pass/fail judgment.
- No evaluator scripts.
- No reference `solution/` directories.
- No misuse classification.
- No extracted "facts" from code or traces.
- No trend analysis, A/B comparison command, graduation, or archiving.
- No hidden hints in problem metadata.

## Command Surface

Implement one command:

```bash
pnpm -C llm-challenge challenge run
```

Supported options:

```text
--sdk-ref <ref>        SDK git ref to pack. Default: current HEAD.
--profile <no-docs|full>
                       Applies only to sdk-api problems. Default: no-docs.
--group <sdk-api|cli|all>
                       Problem group to run. Default: all.
--model <model>        Codex model. Default: gpt-5.5.
--effort <effort>      Codex reasoning effort. Default: xhigh.
--runs <n>             Independent runs per problem. Default: 3.
--concurrency <n>      Parallel task count. Default: 1.
--problem <key>        Repeatable problem filter. Accepts <group>/<id> or a unique bare id.
--problems <keys>      Comma-separated problem filter.
--output <dir>         Output directory. Default: results/<run-id>.
--max-seconds <n>      Per-run Codex timeout. Default: 1800.
```

If `--group cli` is combined with an explicitly provided `--profile`, exit with an error because CLI problems do not use profiles. The implicit default profile must not make `--group cli` fail. If `--group all --profile full` is used, run `sdk-api` with `full` and `cli` with no profile.

## Problem Groups

### `sdk-api`

Tasks where the AI writes SDK project code. These problems use SDK package profiles.

Profiles:

- `no-docs`: runnable SDK package, with README, CHANGELOG, docs, examples, `agent-skills`, `skills`, and declaration-file JSDoc removed. Runtime JS remains.
- `full`: packaged SDK as-is.

### `cli`

Tasks where the AI should discover and use the local `tailor-sdk` CLI. These problems always receive a runnable full SDK package and have `profile: null` in reports.

CLI prompts may mention the `tailor-sdk` binary name, but must not provide the subcommand or exact arguments being tested.

## Isolation

Run Codex inside Podman.

Mount only:

- The generated problem workspace as read-write.
- The Codex auth file as read-only.

Do not mount:

- The host repository.
- Global `AGENTS.md`.
- User skills.
- Dotfiles.

Network, web access, shell commands, `pnpm install`, and edits inside the workspace are allowed. The tool records what happened; it does not restrict or judge it.

## Problem Structure

Each problem contains only:

```text
llm-challenge/problems/
  sdk-api/
    <id>/
      meta.json
      prompt.md
      scaffold/
  cli/
    <id>/
      meta.json
      prompt.md
      scaffold/
```

The directory under `problems/` is the source of truth for the problem group. Do not duplicate the group in `meta.json`. Problem IDs should be unique across both groups so filters, report rows, and artifact paths stay easy to read.

`meta.json`:

```json
{
  "id": "plugin-registration",
  "title": "Register plugins in the SDK config"
}
```

`prompt.md` is written in English. For `sdk-api` problems, do not include SDK API names or code examples. For `cli` problems, the prompt may name `tailor-sdk` but must not name the intended subcommand or arguments.

## Initial Problem Set

Create these 19 problems:

```text
llm-challenge/problems/sdk-api/
  tailordb-field-options
  tailordb-relation-naming
  tailordb-type-hooks

  resolver-context
  resolver-structured-result

  executor-record-multi-event
  executor-resolver-executed-trigger
  executor-idp-user-multi-event

  workflow-job-chaining
  workflow-wait-point

  config-define-config-wiring
  config-static-website-url
  config-idp-provider-wiring

  plugin-registration
  plugin-generated-getdb

llm-challenge/problems/cli/
  generate
  tailordb-migrate-generate
  tailordb-migrate-script
  help-error-recovery
```

## Artifact Layout

Write artifacts under the chosen output directory:

```text
results/<run-id>/
  report.json
  <group>/
    <problem-id>/
      run-0/
        prompt.md
        solver.stdout.log
        solver.stderr.log
        trace.jsonl
        work/
```

`work/` is the final workspace snapshot immediately after Codex exits. Do not run `generate`, `typecheck`, or any other stage after the solver. A human should inspect `work/`, logs, and trace directly.

## Report Schema

Write `report.json` using this shape:

```ts
type ChallengeReport = {
  schemaVersion: 1;
  runId: string;
  timestamp: string;
  sdkRef: string;
  sdkVersion?: string;
  requestedProfile: "no-docs" | "full";
  model: string;
  effort: string;
  runsPerProblem: number;
  problems: Array<{
    id: string;
    title: string;
    group: "sdk-api" | "cli";
    sourcePath: string;
  }>;
  runs: Array<{
    problemId: string;
    group: "sdk-api" | "cli";
    profile: "no-docs" | "full" | null;
    runIndex: number;
    artifactDir: string;
    promptPath: string;
    solverStdoutPath: string;
    solverStderrPath: string;
    tracePath: string;
    worktreePath: string;
    solverExitCode?: number;
    durationMs?: number;
    timedOut?: boolean;
  }>;
};
```

Paths in reports are relative to `llm-challenge/`.

## Terminal Output

Do not print `PASS`, `FAIL`, `improved`, `regressed`, or similar judgment terms. Print only progress, artifact paths, solver exit codes, timeouts, and report location.

Example:

```text
Problem                         Run   Artifact                                      Solver
sdk-api/plugin-registration     0     results/.../sdk-api/plugin-registration/...   exit=0
cli/tailordb-migrate-generate   0     results/.../cli/tailordb-migrate-generate/... timeout
```

## Implementation Order

1. Create the `llm-challenge` package with `package.json`, `tsconfig.json`, and `src/cli.ts`.
2. Implement problem discovery from `problems/sdk-api/*` and `problems/cli/*`, deriving each problem group from its directory.
3. Implement SDK packing from `--sdk-ref`.
4. Implement profile filtering for `no-docs`.
5. Implement workspace creation from `scaffold/`.
6. Implement the Podman Codex runner.
7. Persist artifacts and `report.json`.
8. Add the 19 problem directories and prompts.
9. Add narrow unit tests for argument parsing, profile filtering, report writing, and artifact paths.

Keep the first implementation small. Add analysis, grading, and comparison only if a later workflow proves they are needed.
