# Testing

## Test Projects

Vitest is configured with several projects (see [`packages/sdk/vitest.config.ts`](../packages/sdk/vitest.config.ts)):

- **unit / unit-core / unit-windows** — Unit tests under `src/**` and `scripts/**`, plus `e2e/cli.test.ts` (the e2e CLI helper's own tests, which need no workspace), split by isolation needs; the `unit*` glob selects all three, and the Windows CI job runs `unit-windows`, whose tests have Windows-specific behavior
- **integration** — Deploy fixture integration tests
- **e2e** — E2E files in `e2e/**` other than `e2e/cli.test.ts` (120-second test timeout); excluded from coverage CI, which runs without Platform credentials
- **scripts** — Tests for repository scripts

CI's `Test` workflow runs `unit*`, `integration`, and `scripts` on every Node version it tests. On pushes to main and pull requests into it, one Node version also collects coverage when the SDK metrics' inputs change.

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

## Migration Deploy Model Test

`packages/sdk/src/cli/commands/deploy/tailordb/migration-model.test.ts` checks the migration deploy flow against a [Quint](https://quint-lang.org/) specification, `test-helpers/migration-deploy.qnt`. Quint simulates thousands of migration histories with a fixed seed; the test deploys each one with `applyTailorDB` against an in-memory namespace that rejects what the Platform rejects, and compares the tables and their shapes at every script, every checkpoint commit, and the end with what the specification expects.

The specification states the intended behavior. A known gap is listed as a definition whose tables `uncheckedAt` leaves out; a fix for the gap removes the definition, so the test pins the fix. Check a specification change with `pnpm exec quint typecheck <file>` in `packages/sdk`.

## E2E Tests

Most E2E suites require Platform credentials, and each of those creates its own disposable workspace. CI deletes the workspaces in a cleanup step keyed by the run ID; `globalSetup`'s teardown also deletes them, authenticating the same way the tests do (`TAILOR_PLATFORM_TOKEN` or the `tailor login` session). If no credentials can be resolved at teardown it only warns, and the workspaces are left for prune to reclaim after their 24-hour expiry.

Located in `packages/sdk/e2e/`. CI runs these only in the `sdk-e2e.yml` workflow (pull requests and pushes to main).

### Writing E2E Suites

- Deploy only a fixture the suite owns, declaring just the resources its tests use. Do not deploy `example/`: a fresh deploy replays its whole migration history, and each data migration waits on a Platform job, so setup time grows with every migration added there. The `Workspace Deploy Test` workflow already covers a fresh deploy of `example/`.
- Run CLI subprocesses through `e2e/cli.ts` (`runCli` / `tryCli`, or `runProcess` / `tryProcess` for another executable). A synchronous call blocks the test worker for the whole call, so Vitest timeouts cannot fire and the worker's Platform connections can go stale. oxlint rejects importing `execSync`, `execFileSync`, `spawnSync`, or the default export of `child_process` under `e2e/`.
- Pass the test's `signal` (`test("…", async ({ signal }) => …)`) to every call. A timed-out test keeps running in the background, so without it the call it started, or one it starts later, overlaps the next test against the same workspace. Hooks have no test signal; pass `undefined` there and keep the hook timeout above the call's budget.
- Give each CLI call an explicit budget (`CLI_BUDGET_MS` covers the common cases) and derive the test timeout from the budgets it spends with `cliTestTimeout`, adding `WORKSPACE_CREATION_ALLOWANCE_MS` when the test also creates a workspace, so a stuck call fails with its own output instead of a bare test timeout.
- Before raising a budget, find which phase grew. The helper logs every CLI line with its elapsed time, reports each call's share of its budget, and emits an `E2E CLI budget` warning on GitHub Actions once a call uses 60% of it.
- Let setup failures fail the suite. Do not substitute a placeholder for a failed lookup; it surfaces later as an unrelated-looking assertion failure.

## Conventions

### Type Assertions

In `packages/sdk`, Vitest type-checks only `*.test-d.ts`, yet reports `Type Errors  no errors` on every run. A type assertion (`assertType`, `expectTypeOf`, `@ts-expect-error`) in a `*.test.ts` fails only under `pnpm typecheck`.

`toMatchTypeOf` is **deprecated**. Use one of:

- `toEqualTypeOf` — Exact type match
- `toMatchObjectType` — Structural match
- `toExtend` — Subtype check

This is enforced by oxlint's local plugin (see `packages/sdk/oxlint-plugins/index.js` and `.oxlintrc.json`).

### Operator Client Mocks

Build an `OperatorClient` mock with `mockOperatorClient()` from `packages/sdk/src/cli/shared/test-helpers/operator-client.ts`, giving each method its response or an implementation, so `tsc` checks them against the RPC (unknown fields only in a response given directly). A streaming method takes only an implementation, such as an async generator function, which starts a new stream on each call. `tsc` also rejects a `vi.fn` spy given as a method, whose response would go unchecked. To mock more methods on a client, such as a test's overrides on top of a helper's defaults, use `withOperatorClientMocks(client, methods)`, which returns a copy that keeps the spy types a spread loses. In `*.test.ts` files and files under `test-helpers/`, oxlint's `local/typed-operator-client-mock` rejects a cast to the client type or to a type naming it (such as `loadOperatorWorkspaceContext`'s result), and an `as never` or `as any` handed to a mocked client loader, including when the client type or the loader is imported under an alias or through a namespace. On a mocked client method and in the methods given to `mockOperatorClient()` or `withOperatorClientMocks()`, it also rejects an `as never` or `as any` response and an annotated request parameter, which `tsc` would leave unchecked. It has no type information, so it misses a client passed `as never` to a function under test or cast through a local type alias; build that client with `mockOperatorClient({})` too. For the same reason, it takes any type indexed with `["client"]`, such as an options type's `["client"]`, for the client, even when that field holds something else, and checks a method mock only when the method's receiver is named `client` or ends in `Client`.

### Logger Mocks

Mock `#/cli/shared/logger` with a factory that takes `importOriginal` and spreads its result before overriding `logger` or `styles`: `vi.mock("#/cli/shared/logger", async (importOriginal) => ({ ...(await importOriginal()), logger: { warn: vi.fn() } }))`. Most CLI modules import the logger module, directly or through another module such as `#/cli/shared/errors`, so a factory that returns only `logger` fails a test as soon as a module it imports indirectly reads another export, such as `JSON_OUTPUT_ENV_VAR`. To silence logger methods without a module mock, use `silenceLogger()` from `packages/sdk/src/cli/shared/test-helpers/silence-logger.ts`. In `*.test.ts` files and files under `test-helpers/`, oxlint's `local/logger-mock-import-original` rejects a `vi.mock` or `vi.doMock` of the logger module, by `#/` or relative path, whose inline factory takes no parameter, including one that spreads `vi.importActual()` instead. It does not check a factory passed by name, or that a factory spreads what `importOriginal()` returns.

## Documentation Tests

CLI reference docs are auto-generated from command definitions. When adding or modifying CLI commands:

```bash
# Check if docs are in sync
pnpm docs:check

# Regenerate docs
pnpm docs:update
```

`packages/sdk/src/cli/command-mentions.test.ts` fails when a message, doc, README, or script in `packages/` names a `tailor` command that neither the CLI nor its plugins define. After renaming or removing a command, update the places it lists.

## Example App Tests

`example/` has its own test suite used in CI:

```bash
cd example
pnpm test                          # Generator tests
pnpm test:e2e                      # E2E tests
pnpm test:generator:update-expects # Regenerate the expected fixtures (build first, see below)
```

`pnpm test` writes generated files and bundles to `tests/fixtures/plugins/`, then runs the bundled-execution tests against them, along with the PGlite and migration tests. No Vitest test reads `tests/fixtures/expected/`; only `tests/kysely-parity.ts` type-checks against its `db.ts`. The `generate.yml` workflow regenerates the example's files and these fixtures and fails if that changes a file. On a pull request from this repository, the `securefix.yml` workflow also pushes the regenerated files as a `chore: apply automated fixes` commit, after which the check passes, so review that commit's diff. After changing code generation, run `pnpm generate` at the repository root (it builds the packages first), then `pnpm --filter example run test:generator:update-expects`, and commit the result when the diff is intended.

To show that a change leaves bundled resolvers, executors, workflow jobs, auth hooks, and HTTP adapters unchanged, run `pnpm snapshot:bundles <outDir>` in `example/` of two built checkouts, your branch and its base commit (for example `git worktree add <dir> <base>`, then `pnpm install && pnpm build` there), and `diff -r` the two directories. Check out the base at the same depth as your branch (for example a sibling directory of the same parent): inline sourcemaps record relative source paths, so a checkout at a different depth makes some inline-true outputs differ. The script bundles `tailor.config.ts` and `tests/tailor.config.plugins-compat.ts` with inline sourcemaps on and off, bypassing the bundle cache. The cache manifest is not included: its input hashes and dependency paths depend on where the checkout is, and the dependency paths also vary between runs of the same build.
