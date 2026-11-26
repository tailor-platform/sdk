---
paths:
  - "packages/sdk/src/**/*.qnt"
  - "packages/sdk/src/**/*-model.test.ts"
  - "packages/sdk/src/**/test-helpers/*-model.ts"
---

# Model-Based Tests (Quint)

Follow [Writing Model-Based Tests](../../docs/testing.md#writing-model-based-tests) when adding or changing a Quint specification or the test that replays it: keep the specification to the intended behavior, name each known gap as a definition of what the specification leaves unchecked, which its fix removes, and check coverage after changing what `init` chooses.
