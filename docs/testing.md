# Testing

## Test Projects

Vitest is configured with several projects (see [`packages/sdk/vitest.config.ts`](../packages/sdk/vitest.config.ts)):

- **unit / unit-core / unit-plugin** — Unit tests under `src/**` and `scripts/**`, split by isolation needs; the `unit*` glob selects all three
- **integration** — Deploy fixture integration tests
- **e2e** — Subprocess-driven e2e files in `e2e/**` (120-second test timeout); excluded from coverage CI because subprocess execution does not contribute coverage data
- **e2e-coverage** — `e2e/deploy.test.ts`, which exercises `deploy()` in-process; the coverage CI job runs it, and `--project=e2e*` selects both e2e projects
- **scripts** — Tests for repository scripts

```bash
# All tests
pnpm test

# In packages/sdk/:
pnpm test                      # All projects
pnpm test:unit                 # Unit only
pnpm test:e2e                  # E2E only (requires deployed workspace)
pnpm test path/to/file.test.ts # Single file
pnpm test -t "pattern"         # Pattern match
```

`-t` matches against the full test name; Vitest 5 joins nested `describe`/`test` names with `>` (e.g. `-t "describe name > test name"`).

## Migration Compatibility Tests

`packages/sdk/src/cli/commands/tailordb/migrate/snapshot-compatibility.test.ts` executes hooks and validators from committed historical fixtures through the current migration reader and manifest generator. The fixtures live in `__test_fixtures__/compatibility/` beside the test; their README records provenance. Preserve the saved expressions rather than regenerating them with the current SDK.

When changing the migration reader or script compiler, verify execution results as well as successful parsing. Cover snapshots and both sides of diffs, nested fields and arrays, mixed historical/current files, validator failure order, and serialization/reloading after rebaselining. Run the existing file-version rejection, replay, rebaseline, and bundler tests alongside these fixtures.

Before raising the minimum supported migration format, identify a released bridge SDK that reads the complete old history and writes a baseline accepted by the target SDK. Test that transition with frozen fixtures before dropping a reader. A new format number alone cannot establish the script contract: historical writers reused format numbers across script changes.

## E2E Tests

E2E tests require a deployed workspace. The `globalSetup` provisions a workspace before tests run.

Located in `packages/sdk/e2e/`. CI runs these in the `sdk-e2e.yml` workflow (pull requests and pushes to main); `sdk-metrics.yml` additionally runs the `e2e-coverage` project under coverage.

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
