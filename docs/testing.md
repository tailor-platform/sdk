# Testing

## Test Projects

Vitest is configured with several projects (see [`packages/sdk/vitest.config.ts`](../packages/sdk/vitest.config.ts)):

- **unit / unit-core / unit-plugin / unit-shell** — Unit tests under `src/**` and `scripts/**`, plus `e2e/cli.test.ts` (the e2e CLI helper's own tests, which need no workspace), split by isolation needs; the `unit*` glob selects all four, and the Windows CI job runs `unit-plugin` and `unit-shell`, whose tests spawn real launchers and shells
- **integration** — Deploy fixture integration tests
- **e2e** — Subprocess-driven e2e files in `e2e/**` other than `e2e/cli.test.ts` (120-second test timeout); excluded from coverage CI because subprocess execution does not contribute coverage data
- **e2e-coverage** — `e2e/deploy.test.ts`, which exercises `deploy()` in-process; the coverage CI job runs it, and `--project=e2e*` selects both e2e projects
- **scripts** — Tests for repository scripts

```bash
# All tests
pnpm test

# In packages/sdk/:
pnpm test                      # All projects
pnpm test:unit                 # Unit only
pnpm test:e2e                  # E2E only (most suites need Platform credentials)
pnpm test path/to/file.test.ts # Single file
pnpm test -t "pattern"         # Pattern match
```

`-t` matches against the full test name; Vitest 5 joins nested `describe`/`test` names with `>` (e.g. `-t "describe name > test name"`).

## Migration Compatibility Tests

`packages/sdk/src/cli/commands/tailordb/migrate/snapshot-compatibility.test.ts` executes hooks and validators from committed historical fixtures through the current migration reader and manifest generator. The fixtures live in `__test_fixtures__/compatibility/` beside the test; their README records provenance. Preserve the saved expressions rather than regenerating them with the current SDK.

When changing the migration reader or script compiler, verify execution results as well as successful parsing. Cover snapshots and both sides of diffs, nested fields and arrays, mixed historical/current files, validator failure order, and serialization/reloading after rebaselining. Run the existing file-version rejection, replay, rebaseline, and bundler tests alongside these fixtures.

Before raising the minimum supported migration format, identify a released bridge SDK that reads the complete old history and writes a baseline accepted by the target SDK. Test that transition with frozen fixtures before dropping a reader. A new format number alone cannot establish the script contract: historical writers reused format numbers across script changes.

## E2E Tests

Most E2E suites require Platform credentials, and each of those creates its own disposable workspace. CI deletes the workspaces in a cleanup step keyed by the run ID; `globalSetup`'s teardown deletes them only when `TAILOR_PLATFORM_TOKEN` is set, so after a local run under `tailor login`, delete them yourself (the `e2e-test` skill's wrapper does this).

Located in `packages/sdk/e2e/`. CI runs these in the `sdk-e2e.yml` workflow (pull requests and pushes to main); `sdk-metrics.yml` additionally runs the `e2e-coverage` project under coverage.

### Writing E2E Suites

- Deploy only a fixture the suite owns, declaring just the resources its tests use. Do not deploy `example/`: a fresh deploy replays its whole migration history, and each data migration waits on a Platform job, so setup time grows with every migration added there. The `Workspace Deploy Test` workflow already covers a fresh deploy of `example/`.
- Run CLI subprocesses through `e2e/cli.ts` (`runCli` / `tryCli`, or `runProcess` / `tryProcess` for another executable). A synchronous call blocks the test worker for the whole call, so Vitest timeouts cannot fire and the worker's Platform connections can go stale. oxlint rejects importing `execSync`, `execFileSync`, `spawnSync`, or the default export of `child_process` under `e2e/`.
- Pass the test's `signal` (`test("…", async ({ signal }) => …)`) to every call. A timed-out test keeps running in the background, so without it the call it started, or one it starts later, overlaps the next test against the same workspace. Hooks have no test signal; pass `undefined` there and keep the hook timeout above the call's budget.
- Give each CLI call an explicit budget (`CLI_BUDGET_MS` covers the common cases) and derive the test timeout from the budgets it spends with `cliTestTimeout`, adding `WORKSPACE_CREATION_ALLOWANCE_MS` when the test also creates a workspace, so a stuck call fails with its own output instead of a bare test timeout.
- Before raising a budget, find which phase grew. The helper logs every CLI line with its elapsed time, reports each call's share of its budget, and emits an `E2E CLI budget` warning on GitHub Actions once a call uses 60% of it.
- Let setup failures fail the suite. Do not substitute a placeholder for a failed lookup; it surfaces later as an unrelated-looking assertion failure.

## Conventions

### Type Assertions

`toMatchTypeOf` is **deprecated**. Use one of:

- `toEqualTypeOf` — Exact type match
- `toMatchObjectType` — Structural match
- `toExtend` — Subtype check

This is enforced by oxlint's local plugin (see `packages/sdk/oxlint-plugins/index.js` and `.oxlintrc.json`).

## Documentation Tests

CLI reference docs are auto-generated from command definitions. When adding or modifying CLI commands:

```bash
# Check if docs are in sync
pnpm docs:check

# Regenerate docs
pnpm docs:update
```

## Example App Tests

`example/` has its own test suite used in CI:

```bash
cd example
pnpm test                          # Generator output tests
pnpm test:e2e                      # E2E tests
pnpm test:generator:update-expects # Update test fixtures after intentional changes
```

Generator tests compare output against expected fixtures in `example/tests/fixtures/`. After intentional changes to code generation, update the fixtures with `test:generator:update-expects`.

To show that a change leaves bundled resolvers, executors, workflow jobs, and auth hooks unchanged, run `pnpm snapshot:bundles <outDir>` in `example/` of two built checkouts, your branch and its base commit (for example `git worktree add <dir> <base>`, then `pnpm install && pnpm build` there), and `diff -r` the two directories. Check out the base at the same depth as your branch (for example a sibling directory of the same parent): inline sourcemaps record relative source paths, so a checkout at a different depth makes some inline-true outputs differ. It bundles `tailor.config.ts` and `tests/tailor.config.plugins-compat.ts` with inline sourcemaps on and off, bypassing the bundle cache. HTTP adapter bundles are not included. Neither is the cache manifest: its input hashes and dependency paths depend on where the checkout is, and the dependency paths also vary between runs of the same build.
