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
  codemod-engine.ts        # ast-grep/napi wrapper + high-level helpers
  rule-helpers.ts          # createRule() / SourceRule - reduces rule boilerplate
  rule-registry.ts         # Version-gated rule selection
  types.ts                 # MigrationRule, TransformContext, TransformResult, FileDiff
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

## Naming Conventions

- **Rule file**: `<rule-name>.ts` (kebab-case, matching the rule id suffix)
- **Exported rule variable**: `<camelCase>Rule` suffix
  (e.g., `defineGeneratorsRule`, `triggerRenameRule`, `dbTypeToModelRule`)
- **Rule id**: `v<N>/<rule-name>` (e.g., `v2/trigger-rename`)

## Step-by-Step

### 1. Create the rule file

For most rules, use `createRule` to eliminate boilerplate:

`packages/sdk/src/cli/commands/upgrade/rules/v2/<rule-name>.ts`:

```typescript
import { renameIdentifiers } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const myRenameRule = createRule(
  {
    id: "v2/<rule-name>",
    name: "Human-readable name",
    description: "What this rule migrates and why.",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    const { output, count } = renameIdentifiers(source, "oldName", "newName");
    return count > 0 ? output : null;
  },
);
```

`createRule` handles the file iteration loop, `transformFile` calls, and
diff collection automatically. You only provide the source-level transform.
The returned `SourceRule` exposes `transformSource` for direct use in tests.

For complex rules that need per-file warnings, implement `MigrationRule`
directly (see "Advanced: manual rule" below).

### 2. Register the rule

Add the import and rule to `rules/v2/index.ts`. Append new rules to the
**end** of the array (independent rules can be in any order, but appending
keeps diffs minimal):

```typescript
import { myRenameRule } from "./<rule-name>";

export const v2Rules: MigrationRule[] = [
  // ... existing rules ...
  myRenameRule,
];
```

Before adding, scan the existing array for potential interactions (e.g.,
rule A renames an identifier that rule B also references).

### 3. Add test fixtures

Create `__test_fixtures__/v2/<rule-name>/input.ts` and `output.ts` with
representative before/after code. These files are excluded from typecheck
and eslint (wildcard `v*/` patterns), so they can contain intentionally
invalid V1 code.

**Important:** `renameIdentifiers` and `batchRename` use `replaceAll`
internally, which also transforms comments and string literals. If
`input.ts` contains the target identifier in a comment (e.g.,
`// Uses retryPolicy`), the `output.ts` must reflect the replacement
(e.g., `// Uses retry`). Mismatched comments are the most common cause
of fixture test failures.

### 4. Write the test

Import the rule and use its `transformSource` property directly --
do **not** duplicate the transform logic in the test file:

`rules/v2/<rule-name>.test.ts`:

```typescript
import { describe, it } from "vitest";
import { runFixtureTest } from "../../__test_fixtures__/fixture-helper";
import { myRenameRule } from "./<rule-name>";

describe("<rule-name> rule", () => {
  it("should transform <description>", async () => {
    await runFixtureTest("v2/<rule-name>", myRenameRule.transformSource);
  });
});
```

`createRule` returns a `SourceRule` that exposes `transformSource`, so
tests can call `rule.transformSource` instead of re-implementing the
transform. This keeps the test as a pure fixture assertion with zero
logic duplication.

### 5. Verify

```bash
pnpm -C packages/sdk test:unit -- src/cli/commands/upgrade/
```

## Codemod Engine API

### High-level helpers (preferred)

#### `renameIdentifiers(source, oldName, newName, lang?)`

Rename all occurrences of an identifier. Works for both `identifier` nodes
(function names, variables, imports) and `property_identifier` nodes (object
property keys). Returns `{ output, count }`.

Uses AST-aware detection via `findIdentifiers`, then `replaceAll` for
replacement. The `replaceAll` step intentionally renames occurrences in
comments too (desirable for migration).

```typescript
const { output, count } = renameIdentifiers(source, "publishEvents", "emitEvents");
return count > 0 ? output : null;
```

#### `batchRename(source, renames, lang?)`

Rename multiple identifiers in one pass. Automatically sorts by key length
(longest first) to prevent substring conflicts. Returns `{ output, count }`.

```typescript
const renames = new Map([
  ["createWorkflowJob", "defineWorkflowJob"],
  ["createWorkflow", "defineWorkflow"],
]);
const { output, count } = batchRename(source, renames);
return count > 0 ? output : null;
```

No need to worry about ordering -- `batchRename` sorts automatically.

#### `getArgs(node, name)`

Extract argument nodes from a variadic capture (`$$$NAME`), filtering out
comma separator nodes automatically.

```typescript
const args = getArgs(node, "ARGS").map((n) => n.text());
// Instead of: node.getMultipleMatches("ARGS").filter((n) => n.kind() !== ",").map(...)
```

#### `findIdentifiers(source, name, lang?)`

Find all `identifier` and `property_identifier` nodes matching an exact
name. Unlike `findPattern`, this also matches object property keys.

```typescript
const matches = findIdentifiers(source, "publishEvents");
// Returns matches in both: import { publishEvents } and { publishEvents: true }
```

### Low-level API

#### `findPattern(source, pattern, lang?)`

Search-only variant using ast-grep pattern syntax. Returns array of matched
`SgNode`. Accepts optional `lang` parameter (defaults to TypeScript).

**Note:** `findPattern` matches `identifier` nodes but NOT
`property_identifier` nodes. For property keys, use `findIdentifiers`
instead.

#### `applyPatternReplace(source, pattern, replacer, lang?)`

Find AST pattern matches and replace them. Returns `{ output, count }`.

- `pattern`: ast-grep pattern syntax. `$NAME` captures a single node,
  `$$$NAME` captures variadic (zero or more) nodes.
- `replacer(node)`: receives matched `SgNode`, returns replacement string.
  Use `node.getMatch("NAME")` or `getArgs(node, "NAME")` to extract values.
- `lang`: optional, defaults to `Lang.TypeScript`.

#### `transformFile(filePath, transformFn, dryRun)`

Read file, apply `transformFn(source)`, write back if changed. Returns
`{ changed, before?, after? }`. The `before`/`after` fields are populated
only in dry-run mode (for diff display).

### `createRule(meta, transformSource)` (from rule-helpers.ts)

Wraps a source-level transform function into a full `SourceRule` (which
extends `MigrationRule`). Handles file iteration, `transformFile` calls,
diff collection, and result aggregation. Most rules should use this.

The returned `SourceRule` exposes `transformSource` so tests can call it
directly without duplicating the transform logic.

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

## Pattern Selection Flowchart

Use this to choose the right transformation strategy:

1. **Is the target an identifier or property key rename?**
   - Single rename → `renameIdentifiers` (handles both `identifier` and
     `property_identifier` nodes)
   - Multiple related renames → `batchRename` (auto-sorts by length)
2. **Is the target an ambiguous method name** (e.g. `type` on a specific object)?
   - Yes → `applyPatternReplace` with receiver guard + `getArgs`
3. **Does the migration involve both a method rename AND a property rename?**
   - Yes → Hybrid: `applyPatternReplace` for method + `renameIdentifiers` for property
4. **Do function arguments need restructuring?**
   - Yes → `applyPatternReplace` with `$$$ARGS` + `getArgs`
5. **Is the target a string literal** (e.g. import path)?
   - Yes → `source.includes()` + `replaceAll` (AST helpers don't match strings)

## Common Patterns

### Simple identifier/property rename (most common)

Use `renameIdentifiers` with `createRule`. Works for function names,
variables, import specifiers, and object property keys:

```typescript
import { renameIdentifiers } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const myRenameRule = createRule(
  { id: "v2/my-rule", name: "...", description: "...", since: "1.0.0", until: "2.0.0" },
  (source) => {
    const { output, count } = renameIdentifiers(source, "oldName", "newName");
    return count > 0 ? output : null;
  },
);
```

### Batch rename (multiple related renames)

Use `batchRename` with `createRule`. No need to worry about substring
ordering -- it sorts automatically:

```typescript
import { batchRename } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

const renames = new Map([
  ["recordCreatedTrigger", "onRecordCreated"],
  ["scheduleTrigger", "onSchedule"],
]);

export const triggerRenameRule = createRule(
  { id: "v2/my-rule", name: "...", description: "...", since: "1.0.0", until: "2.0.0" },
  (source) => {
    const { output, count } = batchRename(source, renames);
    return count > 0 ? output : null;
  },
);
```

### Receiver-guarded method rename

When renaming a method on a specific object (e.g., `db.type()` to
`db.model()`) and the method name is ambiguous, use `applyPatternReplace`
with a guard:

```typescript
import { applyPatternReplace, getArgs } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const dbTypeToModelRule = createRule(
  { id: "v2/my-rule", name: "...", description: "...", since: "1.0.0", until: "2.0.0" },
  (source) => {
    const result = applyPatternReplace(source, "$OBJ.type($$$ARGS)", (node) => {
      const obj = node.getMatch("OBJ")!.text();
      if (obj !== "db") return node.text(); // guard: skip non-db receivers
      const args = getArgs(node, "ARGS").map((n) => n.text());
      return `${obj}.model(${args.join(", ")})`;
    });
    return result.count > 0 ? result.output : null;
  },
);
```

### Hybrid: method rename + property rename

When both a method call and a property key need renaming, combine
`applyPatternReplace` with `renameIdentifiers`:

```typescript
import { applyPatternReplace, getArgs, renameIdentifiers } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const authInvokerRenameRule = createRule(
  { id: "v2/my-rule", name: "...", description: "...", since: "1.0.0", until: "2.0.0" },
  (source) => {
    let result = source;
    let totalChanged = 0;

    // Pass 1: Rename method calls using AST matching
    const pass1 = applyPatternReplace(result, "$OBJ.invoker($$$ARGS)", (node) => {
      const obj = node.getMatch("OBJ")!.text();
      const args = getArgs(node, "ARGS").map((n) => n.text());
      return `${obj}.machineUser(${args.join(", ")})`;
    });
    result = pass1.output;
    totalChanged += pass1.count;

    // Pass 2: Rename property key using AST-aware detection
    const pass2 = renameIdentifiers(result, "authInvoker", "invoker");
    if (pass2.count > 0) {
      result = pass2.output;
      totalChanged += pass2.count;
    }

    return totalChanged > 0 ? result : null;
  },
);
```

### Import path rename (string literal)

For import path changes, AST helpers don't match string literals. Use
`source.includes()` + `replaceAll`:

```typescript
import { createRule } from "../../rule-helpers";

export const importPathRule = createRule(
  { id: "v2/my-rule", name: "...", description: "...", since: "1.0.0", until: "2.0.0" },
  (source) => {
    if (!source.includes("@tailor-platform/sdk/tailordb")) return null;
    return source.replaceAll("@tailor-platform/sdk/tailordb", "@tailor-platform/sdk/schema");
  },
);
```

### Advanced: manual rule (when `createRule` is not enough)

Use this only when you need per-file warnings or custom result handling.
Implement `MigrationRule` directly with `transformFile`:

```typescript
import { transformFile, renameIdentifiers } from "../../codemod-engine";
import type { FileDiff, MigrationRule } from "../../types";

export const myManualRule: MigrationRule = {
  id: "v2/my-rule",
  name: "...",
  description: "...",
  since: "1.0.0",
  until: "2.0.0",
  async transform(ctx) {
    const filesModified: string[] = [];
    const warnings: string[] = [];
    const diffs: FileDiff[] = [];

    for (const file of ctx.files) {
      const result = await transformFile(
        file,
        (source) => {
          // custom transform logic here
          return null;
        },
        ctx.dryRun,
      );

      if (result.changed) {
        filesModified.push(file);
        if (result.before !== undefined && result.after !== undefined) {
          diffs.push({ file, before: result.before, after: result.after });
        }
      }
    }

    return {
      changed: filesModified.length > 0,
      filesModified,
      warnings,
      diffs: diffs.length > 0 ? diffs : undefined,
    };
  },
};
```

**Note:** Manual rules do not expose `transformSource`, so tests must
duplicate the transform logic or extract it into a shared function.

### Add a warning for manual attention

```typescript
const matches = findIdentifiers(source, "deprecatedApi");
if (matches.length > 0) {
  warnings.push(
    `${file}: Found ${matches.length} occurrences of deprecatedApi that require manual migration`,
  );
}
```

## False Positive Risk

`renameIdentifiers` and `batchRename` use AST-aware detection (only
matching actual identifier/property nodes), then `replaceAll` for
replacement. This means:

- **Detection is AST-safe**: won't trigger on identifiers inside string
  literals or comments. If `publishEvents` only appears in a comment,
  the rule correctly skips the file.
- **Replacement covers comments**: if the identifier exists in both code
  and a comment, both are renamed. This is desirable for migration.

| Risk level | Name characteristics                                                    | Strategy                                                          |
| ---------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Low        | Long, domain-specific (e.g. `recordCreatedTrigger`, `defineGenerators`) | `renameIdentifiers` or `batchRename`                              |
| Medium     | Short but scoped to a context (e.g. `type` as a method name)            | `applyPatternReplace` with receiver guard                         |
| High       | Common word that appears in many contexts (e.g. `name`, `value`)        | `applyPatternReplace` with narrow AST pattern; avoid `replaceAll` |

## Rule Ordering

Rules within a version array execute sequentially in registration order.

- **Independent rules** (touching different identifiers/properties) can be
  in any order. Append new rules to the end of the array for minimal diffs.
- **`batchRename` handles substring conflicts internally** by sorting
  longest-first, so ordering within a batch is automatic.
- When adding a new rule, check existing rules in the version array for
  potential interactions (e.g., rule A renames an identifier that rule B
  also references). If rule B depends on rule A's output, place A first.
