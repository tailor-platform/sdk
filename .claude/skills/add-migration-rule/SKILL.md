---
name: add-migration-rule
description: >
  Add a new migration rule to the `tailor-sdk upgrade` command.
  Use when adding codemods for breaking changes, or when user mentions
  "migration rule", "codemod", "upgrade rule", or "breaking change codemod".
---

# Add Migration Rule

Add AST-based codemod rules to `tailor-sdk upgrade` for automatic migration across breaking SDK changes.

## Architecture

```
packages/sdk/src/cli/commands/upgrade/
  codemod-engine.ts        # ast-grep/napi wrapper + high-level helpers
  rule-helpers.ts          # createRule() / createWarningRule() - reduces boilerplate
  rule-registry.ts         # Version-gated rule selection
  types.ts                 # MigrationRule, TransformContext, TransformResult, FileDiff
  rules/
    index.ts               # Creates default registry, registers all version rule sets
    v2/index.ts            # V2 rules array
    v2/<rule-name>.ts      # Individual rule implementations
  __test_fixtures__/
    fixture-helper.ts      # runFixtureTest() helper
    v2/<rule-name>/
      input.ts / output.ts # Before/after fixtures
```

**Naming**: File `<rule-name>.ts` (kebab-case), export `<camelCase>Rule`, id `v<N>/<rule-name>`.

## Workflow

### 1. Create rule file

`rules/v2/<rule-name>.ts` — use `createRule` for most rules:

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

`createRule` handles file iteration, `transformFile`, and diff collection. Returns a `SourceRule` with `transformSource` for testing.

For non-TS files, add `filePatterns: ["**/*.sh", "**/*.yml"]` to metadata.
Default: `**/*.{ts,tsx,mts,cts}` (always excludes `node_modules`, `dist`, `.git`).

### 2. Register the rule

Append to `rules/v2/index.ts`. Check existing rules for interactions first.

```typescript
import { myRenameRule } from "./<rule-name>";
export const v2Rules: MigrationRule[] = [, /* existing */ myRenameRule];
```

### 3. Write tests

Fixture files are excluded from typecheck/eslint (wildcard `v*/` patterns).

**Fixture test** (primary): Create `__test_fixtures__/v2/<rule-name>/input.ts` and `output.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { runFixtureTest } from "../../__test_fixtures__/fixture-helper";
import { myRenameRule } from "./<rule-name>";

describe("<rule-name> rule", () => {
  it("should transform <description>", async () => {
    await runFixtureTest("v2/<rule-name>", myRenameRule.transformSource);
  });
});
```

**No-op test** (required): Verify `null` for unrelated code and similar names on different receivers.

**Inline test**: For edge cases (optional chaining, multiple occurrences) without full fixture dirs.

**Warning rule test**: Call `myWarningRule.scanSource(source, filePath)`, check returned string(s) or null.

**JSON rule test**: Use tmpDir with `transformJsonFile`, test mutation and no-op cases.

**Multi-pass test**: Test each helper pass independently, then end-to-end.

**Important**: `renameIdentifiers`/`batchRename` use `replaceAll` internally — transforms comments/strings too. Fixtures must reflect comment changes.

### 4. Verify

```bash
pnpm -C packages/sdk test:unit -- src/cli/commands/upgrade/
```

**Checklist**: fixture test, no-op tests, edge cases, comment/string handling, warning scan cases, JSON mutation/no-op.

## Codemod Engine API

All helpers accept optional `lang?` param (defaults to TypeScript).

### High-level (preferred)

| Helper                     | Signature                                     | Returns                    | Notes                                                                                     |
| -------------------------- | --------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------- |
| `renameIdentifiers`        | `(source, old, new)`                          | `{output, count}`          | AST-detects `identifier` + `property_identifier`, then `replaceAll` (includes comments)   |
| `batchRename`              | `(source, Map<old,new>)`                      | `{output, count}`          | Auto-sorts longest-first to prevent substring conflicts                                   |
| `findIdentifiers`          | `(source, name)`                              | `SgNode[]`                 | Finds `identifier` and `property_identifier` nodes                                        |
| `getArgs`                  | `(node, name)`                                | `SgNode[]`                 | Extracts args from `$$$NAME` capture, filters comma separators                            |
| `renamePropertyInPattern`  | `(source, pattern, oldProp, newProp)`         | `{output, count}`          | Renames only within pattern matches. `count` = pattern matches, check `output !== source` |
| `renameImportSpecifier`    | `(source, old, new, module?)`                 | `{output, count}`          | Import declarations only, not code body                                                   |
| `removeImportSpecifier`    | `(source, name, module?)`                     | `{output, count}`          | Removes entire import if last specifier                                                   |
| `addImportSpecifier`       | `(source, name, module)`                      | `{output, count}`          | Creates import if needed, deduplicates                                                    |
| `removeProperty`           | `(source, objectPattern, prop)`               | `{output, count}`          | Handles comma cleanup                                                                     |
| `addProperty`              | `(source, objectPattern, prop, value)`        | `{output, count}`          | Deduplicates                                                                              |
| `wrapExpression`           | `(source, pattern, template)`                 | `{output, count}`          | `$EXPR` placeholder in template                                                           |
| `replacePropertyValue`     | `(source, objectPattern, prop, replacer)`     | `{output, count}`          | `replacer(valueNode) => string`                                                           |
| `renamePropertyAccess`     | `(source, receiverPattern, oldProp, newProp)` | `{output, count}`          | Handles `.` and `?.`. Pattern must match exact operator                                   |
| `transformTupleArgsToCall` | `(source, callName, mappings)`                | `{output, count, imports}` | Converts `["pkg", config]` to `fn(config)`. Use `addImportSpecifier` for `imports`        |
| `transformCallArguments`   | `(source, fnName, transformer)`               | `{output, count}`          | `transformer(argNodes[]) => string`. Supports `$OBJ.method` patterns                      |
| `renamePropertyAtPath`     | `(source, rootPattern, dotPath, old, new)`    | `{output, count}`          | Dot-separated path (e.g. `"userProfile"`). Empty string for root                          |

### Low-level

| Helper                | Signature                         | Returns                      | Notes                                                                   |
| --------------------- | --------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `findPattern`         | `(source, pattern)`               | `SgNode[]`                   | Matches `identifier` but NOT `property_identifier`                      |
| `applyPatternReplace` | `(source, pattern, replacer)`     | `{output, count}`            | `$NAME` = single node, `$$$NAME` = variadic. `replacer(node) => string` |
| `transformFile`       | `(filePath, transformFn, dryRun)` | `{changed, before?, after?}` | Read/transform/write. `before`/`after` only in dry-run                  |
| `transformJsonFile`   | `(filePath, mutator, dryRun)`     | `TransformFileResult`        | `mutator` returns null for no change. 2-space indent + trailing newline |

### Rule helpers (rule-helpers.ts)

- **`createRule(meta, transformSource)`** — wraps source transform into `SourceRule` (extends `MigrationRule`). Exposes `transformSource` for tests.
- **`createWarningRule(meta, scanSource)`** — scan-only rule. `scanSource(source, file) => string | string[] | null`. Exposes `scanSource` for tests.

## Version Gating

Rules use `since`/`until` semver. A rule applies when source is in `[since, until)` and target is `>= until`.

**New version** (v3, etc.): Create `rules/v3/index.ts` with `v3Rules` array, register in `rules/index.ts`. Wildcard `v*/` patterns cover it automatically.

## Pattern Selection

1. **Identifier/property key rename?** → `renameIdentifiers` (single) or `batchRename` (multiple)
2. **Ambiguous method name on specific object?** (e.g. `db.type()`) → `applyPatternReplace` with receiver guard
3. **Common property scoped to a call?** (e.g. `attributes` in `defineAuth`) → `renamePropertyInPattern`
4. **Method rename + property rename?** → `applyPatternReplace` + `renameIdentifiers` (two passes)
5. **Property in access chain?** (e.g. `context.user.attributes`) → `renamePropertyAccess`
6. **Argument restructuring?** → Tuple-to-call: `transformTupleArgsToCall`. Other: `transformCallArguments`. Complex: `applyPatternReplace` + `getArgs`
7. **Property value replacement?** → `replacePropertyValue`
8. **Nested property at specific path?** → `renamePropertyAtPath`
9. **Add/remove object property?** → `addProperty` / `removeProperty`
10. **Wrap expression?** → `wrapExpression` with `$EXPR`
11. **Import specifier change?** → `addImportSpecifier` / `removeImportSpecifier` / `renameImportSpecifier`
12. **String literal (import path)?** → `source.includes()` + `replaceAll` (AST helpers don't match strings)
13. **Warning only?** → `createWarningRule`
14. **Non-TS files?** → Set `filePatterns` on metadata
15. **JSON files?** → `transformJsonFile` in manual rule

## Common Patterns

All patterns below show only the transform body inside `createRule`. Wrap with the template from Step 1.

### Batch rename

```typescript
const renames = new Map([
  ["recordCreatedTrigger", "onRecordCreated"],
  ["scheduleTrigger", "onSchedule"],
]);
(source) => {
  const { output, count } = batchRename(source, renames);
  return count > 0 ? output : null;
};
```

### Receiver-guarded method rename

```typescript
(source) => {
  const result = applyPatternReplace(source, "$OBJ.type($$$ARGS)", (node) => {
    const obj = node.getMatch("OBJ")!.text();
    if (obj !== "db") return node.text(); // guard: skip non-db receivers
    const args = getArgs(node, "ARGS").map((n) => n.text());
    return `${obj}.model(${args.join(", ")})`;
  });
  return result.count > 0 ? result.output : null;
};
```

### Hybrid: method rename + property rename (two passes)

```typescript
(source) => {
  let result = source;
  let changed = 0;

  // Pass 1: method call via AST
  const p1 = applyPatternReplace(result, "$OBJ.invoker($$$ARGS)", (node) => {
    const obj = node.getMatch("OBJ")!.text();
    const args = getArgs(node, "ARGS").map((n) => n.text());
    return `${obj}.machineUser(${args.join(", ")})`;
  });
  result = p1.output;
  changed += p1.count;

  // Pass 2: property key via identifier rename
  const p2 = renameIdentifiers(result, "authInvoker", "invoker");
  if (p2.count > 0) {
    result = p2.output;
    changed += p2.count;
  }

  return changed > 0 ? result : null;
};
```

### Context-limited property rename

```typescript
(source) => {
  const { output, count } = renamePropertyInPattern(
    source,
    "defineAuth($$$ARGS)",
    "attributes",
    "map",
  );
  return count > 0 && output !== source ? output : null;
};
```

### Import manipulation (multi-step)

```typescript
(source) => {
  let result = source;
  let changed = false;
  const r1 = removeImportSpecifier(result, "defineGenerators", "@tailor-platform/sdk");
  if (r1.count > 0) {
    result = r1.output;
    changed = true;
  }
  const r2 = addImportSpecifier(result, "definePlugins", "@tailor-platform/sdk");
  if (r2.count > 0) {
    result = r2.output;
    changed = true;
  }
  return changed ? result : null;
};
```

### Tuple-to-call + rename + import (complex multi-step)

```typescript
(source) => {
  let result = source;
  let changed = false;

  const r1 = transformTupleArgsToCall(result, "defineGenerators", pluginMappings);
  if (r1.count > 0) {
    result = r1.output;
    changed = true;
    for (const imp of r1.imports) {
      result = addImportSpecifier(result, imp.specifier, imp.path).output;
    }
  }

  const r2 = renameIdentifiers(result, "defineGenerators", "definePlugins");
  if (r2.count > 0) {
    result = r2.output;
    changed = true;
  }
  return changed ? result : null;
};
```

### Import path (string literal)

```typescript
(source) => {
  if (!source.includes("@tailor-platform/sdk/tailordb")) return null;
  return source.replaceAll("@tailor-platform/sdk/tailordb", "@tailor-platform/sdk/schema");
};
```

### Warning-only rule

```typescript
import { createWarningRule } from "../../rule-helpers";

export const myWarningRule = createWarningRule(
  { id: "v2/<rule-name>", name: "...", description: "...", since: "1.0.0", until: "2.0.0" },
  (source, file) => {
    const matches = findIdentifiers(source, "timestamps");
    return matches.length > 0
      ? `${file}: updatedAt now defaults to current time. Review timestamp behavior.`
      : null;
  },
);
```

### Manual rule (when `createRule` insufficient)

Implement `MigrationRule` directly with `transformFile` / `transformJsonFile`. Manual rules don't expose `transformSource` — extract transform logic into a shared function for testing.

```typescript
export const myManualRule: MigrationRule = {
  id: "v2/my-rule",
  name: "...",
  description: "...",
  since: "1.0.0",
  until: "2.0.0",
  filePatterns: ["**/package.json"], // optional
  async transform(ctx) {
    const filesModified: string[] = [];
    const diffs: FileDiff[] = [];
    for (const file of ctx.files) {
      const result = await transformJsonFile(
        file,
        (parsed) => {
          /* mutate or return null */
        },
        ctx.dryRun,
      );
      if (result.changed) {
        filesModified.push(file);
        if (result.before && result.after)
          diffs.push({ file, before: result.before, after: result.after });
      }
    }
    return {
      changed: filesModified.length > 0,
      filesModified,
      warnings: [],
      diffs: diffs.length > 0 ? diffs : undefined,
    };
  },
};
```

## False Positive Risk

| Risk      | Characteristics                                         | Strategy                                       |
| --------- | ------------------------------------------------------- | ---------------------------------------------- |
| Low       | Long, domain-specific (`recordCreatedTrigger`)          | `renameIdentifiers` / `batchRename`            |
| Medium    | Short but scoped (`type` as method)                     | `applyPatternReplace` with receiver guard      |
| High      | Common word in access chain (`context.user.attributes`) | `renamePropertyAccess` with receiver pattern   |
| High      | Common word in specific calls (`attributes` in auth)    | `renamePropertyInPattern`                      |
| Very High | Common word everywhere (`name`, `value`)                | Narrow `applyPatternReplace` + manual replacer |

## Rule Ordering

Rules execute sequentially in registration order. Independent rules: any order (append for minimal diffs). `batchRename` sorts internally. Check for interactions when adding (rule A renames what rule B references → place A first).
