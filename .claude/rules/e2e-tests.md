---
paths:
  - "packages/sdk/e2e/**"
---

# SDK E2E Tests

Follow [Writing E2E Suites](../../docs/testing.md#writing-e2e-suites) when adding or changing a suite under `packages/sdk/e2e/`: deploy a fixture the suite owns instead of `example/`, run CLI subprocesses through `e2e/cli.ts`, derive test timeouts from the CLI budgets they spend, and find which phase grew before raising a budget.
