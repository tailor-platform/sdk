---
name: add-migration-rule
description: >
  Add a new migration rule to the `tailor-sdk upgrade` command.
  Use when adding codemods for breaking changes, or when user mentions
  "migration rule", "codemod", "upgrade rule", or "breaking change codemod".
---

# Add Migration Rule

Add AST-based codemod rules to `tailor-sdk upgrade` so users can automatically
migrate their projects across breaking SDK changes.

## Architecture

```
packages/sdk/src/cli/commands/upgrade/
  codemod-engine.ts        # ast-grep/napi wrapper (parseTypeScript, applyPatternReplace, transformFile)
  rule-registry.ts         # Version-gated rule selection
  types.ts                 # MigrationRule, TransformContext, TransformResult interfaces
  rules/
    index.ts               # Creates default registry, registers all version rule sets
    v2/index.ts            # V2 rules array
    v2/<rule-name>.ts      # Individual rule implementations
  __test_fixtures__/
    fixture-helper.ts      # runFixtureTest() helper
    v2/<rule-name>/
      input.ts             # Source code before migration
      output.ts            # Expected code after migration
```

## Step-by-Step

### 1. Create the rule file

`packages/sdk/src/cli/commands/upgrade/rules/v2/<rule-name>.ts`:

```typescript
import { applyPatternReplace, transformFile } from "../../codemod-engine";
import type { MigrationRule } from "../../types";

export const myRule: MigrationRule = {
  id: "v2/<rule-name>",
  name: "Human-readable name",
  description: "What this rule migrates and why.",
  since: "1.0.0", // Minimum source version (inclusive)
  until: "2.0.0", // Version where the breaking change lands (exclusive for source)
  async transform(ctx) {
    const filesModified: string[] = [];
    const warnings: string[] = [];

    for (const file of ctx.files) {
      const changed = await transformFile(
        file,
        (source) => {
          const result = applyPatternReplace(source, "<ast-grep pattern>", (node) => {
            // Use node.getMatch("NAME") for single captures ($NAME)
            // Use node.getMultipleMatches("NAME") for variadic captures ($$$NAME)
            return "<replacement string>";
          });
          return result.count > 0 ? result.output : null;
        },
        ctx.dryRun,
      );
      if (changed) filesModified.push(file);
    }

    return { changed: filesModified.length > 0, filesModified, warnings };
  },
};
```

### 2. Register the rule

Add to `rules/v2/index.ts`:

```typescript
import { myRule } from "./<rule-name>";

export const v2Rules: MigrationRule[] = [
  myRule,
  // other rules...
];
```

### 3. Add test fixtures

Create `__test_fixtures__/v2/<rule-name>/input.ts` and `output.ts` with
representative before/after code. These files are excluded from typecheck
and eslint (wildcard `v*/` patterns), so they can contain intentionally
invalid V1 code.

### 4. Write the test

`rules/v2/<rule-name>.test.ts`:

```typescript
import { describe, it } from "vitest";
import { runFixtureTest } from "../../__test_fixtures__/fixture-helper";
import { applyPatternReplace } from "../../codemod-engine";

describe("<rule-name> rule", () => {
  it("should transform <description>", async () => {
    await runFixtureTest("v2/<rule-name>", (source) => {
      // Replicate the transform logic from the rule
      const result = applyPatternReplace(source, "<pattern>", (node) => {
        return "<replacement>";
      });
      return result.count > 0 ? result.output : null;
    });
  });
});
```

### 5. Verify

```bash
pnpm -C packages/sdk test:unit -- src/cli/commands/upgrade/
```

## Codemod Engine API

### `applyPatternReplace(source, pattern, replacer, lang?)`

Find AST pattern matches and replace them. Returns `{ output, count }`.

- `pattern`: ast-grep pattern syntax. `$NAME` captures a single node,
  `$$$NAME` captures variadic (zero or more) nodes.
- `replacer(node)`: receives matched `SgNode`, returns replacement string.
  Use `node.getMatch("NAME")` or `node.getMultipleMatches("NAME")` to
  extract captured values.
- `lang`: optional, defaults to `Lang.TypeScript`. Use `Lang.Tsx` for `.tsx` files.

### `transformFile(filePath, transformFn, dryRun)`

Read file, apply `transformFn(source)`, write back if changed. Returns boolean.
`transformFn` should return `null` or the original source if no changes.

### `findPattern(source, pattern, lang?)`

Search-only variant. Returns array of matched `SgNode` without modification.

## Version Gating

Rules use `since` / `until` semver fields:

- `since`: earliest version this rule applies FROM (user is on this version or later)
- `until`: version where the breaking change is introduced

A rule applies when:

- Source version is in `[since, until)`
- Target version is `>= until`

Example: `since: "1.0.0", until: "2.0.0"` applies when upgrading from any 1.x to 2.0+.

## Adding a New Version (v3, v4, ...)

1. Create `rules/v3/index.ts` exporting a `v3Rules` array
2. Import and register in `rules/index.ts`: `registry.registerAll(v3Rules)`
3. Create `__test_fixtures__/v3/` directory for fixtures
4. No config changes needed (wildcard `v*/` patterns cover new versions)

## Common Patterns

### Rename a function call

```typescript
applyPatternReplace(source, "oldName($$$ARGS)", (node) => {
  const args = node
    .getMultipleMatches("ARGS")
    .map((n) => n.text())
    .join(", ");
  return `newName(${args})`;
});
```

### Rename an import specifier

```typescript
// Replace: import { oldName } from "@tailor-platform/sdk"
// With:    import { newName } from "@tailor-platform/sdk"
applyPatternReplace(
  source,
  'import { $$$BEFORE, oldName, $$$AFTER } from "@tailor-platform/sdk"',
  (node) => {
    const before = node
      .getMultipleMatches("BEFORE")
      .map((n) => n.text())
      .join(", ");
    const after = node
      .getMultipleMatches("AFTER")
      .map((n) => n.text())
      .join(", ");
    const specifiers = [before, "newName", after].filter(Boolean).join(", ");
    return `import { ${specifiers} } from "@tailor-platform/sdk"`;
  },
);
```

### Add a warning for manual attention

When a pattern cannot be fully auto-migrated:

```typescript
const matches = findPattern(source, "<pattern>");
if (matches.length > 0) {
  warnings.push(`${file}: Found <N> occurrences of <X> that require manual migration`);
}
```
