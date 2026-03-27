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

#### `renamePropertyInPattern(source, pattern, oldProp, newProp, lang?)`

Rename identifiers only within AST matches of a pattern. Prevents false
positives by scoping the rename to matching contexts only. Internally uses
`applyPatternReplace` + `renameIdentifiers` on the matched subtext.

```typescript
const { output, count } = renamePropertyInPattern(
  source,
  "defineAuth($$$ARGS)",
  "attributes",
  "map",
);
return count > 0 && output !== source ? output : null;
```

**Note:** `count` is the number of pattern matches processed (not individual
identifier renames). Check `output !== source` to determine if anything
actually changed.

#### `renameImportSpecifier(source, oldName, newName, moduleSpecifier?, lang?)`

Rename a named import specifier within import declarations only. Does not
affect code body usage. Returns `{ output, count }`.

#### `removeImportSpecifier(source, specifierName, moduleSpecifier?, lang?)`

Remove a named import specifier. Removes the entire import statement if
it was the last specifier. Returns `{ output, count }`.

#### `addImportSpecifier(source, specifierName, moduleSpecifier, lang?)`

Add a named import to an existing import statement, or create a new one.
Detects duplicates (returns count 0 if already present). Returns `{ output, count }`.

#### `removeProperty(source, objectPattern, propertyName, lang?)`

Remove a key-value pair from objects within pattern matches. Handles
comma cleanup. Returns `{ output, count }`.

#### `addProperty(source, objectPattern, propertyName, propertyValue, lang?)`

Add a property to objects within pattern matches. Detects duplicates.
Returns `{ output, count }`.

#### `wrapExpression(source, pattern, wrapperTemplate, lang?)`

Wrap matched expressions using a template with `$EXPR` placeholder.
Returns `{ output, count }`.

#### `replacePropertyValue(source, objectPattern, propertyName, replacer, lang?)`

Replace the value of a specific property within objects matching a pattern.
The `replacer` function receives the value `SgNode` and returns the new
value text. Returns `{ output, count }`.

```typescript
const { output, count } = replacePropertyValue(
  source,
  "config($$$ARGS)",
  "handler",
  (valueNode) => `newHandler(${valueNode.text()})`,
);
```

#### `renamePropertyAccess(source, receiverPattern, oldProp, newProp, lang?)`

Rename a property in member access expressions, handling both `.` and `?.`
access. Matches `receiverPattern.oldProp` and `receiverPattern?.oldProp`
patterns and renames only the property identifier. Returns `{ output, count }`.

```typescript
// Renames context.user.attributes and context.user.attributes?.role
// but NOT element.attributes
const { output, count } = renamePropertyAccess(
  source,
  "$A.user", // receiver pattern
  "attributes", // old property name
  "map", // new property name
);
return count > 0 ? output : null;
```

**Note:** The receiver pattern must match the exact access operator.
`$A.user` matches `context.user` (dot) but not `context?.user` (optional chain).
To match both, apply twice with different receiver patterns, or use a broad
pattern like `$A`.

#### `transformTupleArgsToCall(source, callName, mappings, lang?)`

Transform tuple arguments in function calls to individual function calls
using a mapping table. Converts `["pkg-name", config]` to `fnName(config)`.
Returns `{ output, count, imports }` where `imports` lists the functions
used (for adding import statements via `addImportSpecifier`).

```typescript
const { output, count, imports } = transformTupleArgsToCall(source, "defineGenerators", [
  {
    packageName: "@tailor-platform/kysely-type",
    functionName: "kyselyTypePlugin",
    importPath: "@tailor-platform/sdk/plugin/kysely-type",
  },
  {
    packageName: "@tailor-platform/enum-constants",
    functionName: "enumConstantsPlugin",
    importPath: "@tailor-platform/sdk/plugin/enum-constants",
  },
]);
// imports: [{ specifier: "kyselyTypePlugin", path: "..." }, ...]
// Use addImportSpecifier() to add the required imports
```

Unknown packages and non-array arguments are preserved as-is.

#### `transformCallArguments(source, functionName, transformer, lang?)`

Transform the arguments of function calls matching a name pattern. The
`transformer` receives an array of argument `SgNode`s (comma separators
filtered out) and returns the new arguments string. The function name is
preserved; use `renameIdentifiers` separately to change it.
Returns `{ output, count }`.

Supports receiver patterns too: `transformCallArguments(source, "$OBJ.method", ...)`.

#### `renamePropertyAtPath(source, rootPattern, propertyPath, oldName, newName, lang?)`

Rename a property at a specific nested path within objects matching a
pattern. The `propertyPath` is dot-separated (e.g., `"userProfile.attributes"`).
Use empty string `""` for root-level properties. Properties with the same
name at other nesting levels are not affected. Returns `{ output, count }`.

```typescript
const { output, count } = renamePropertyAtPath(
  source,
  "defineAuth($$$ARGS)",
  "userProfile", // navigate to userProfile first
  "attributes", // then rename this property
  "map",
);
// { userProfile: { attributes: {...} } } → { userProfile: { map: {...} } }
// Root-level `attributes` is untouched
```

#### `transformJsonFile(filePath, mutator, dryRun)` (async)

Read a JSON file, apply a mutator function to the parsed value, and
optionally write back. Output is formatted with 2-space indentation and
trailing newline. Returns `TransformFileResult` (same as `transformFile`).

```typescript
const result = await transformJsonFile(
  "package.json",
  (parsed) => {
    const pkg = parsed as Record<string, unknown>;
    const scripts = { ...(pkg.scripts as Record<string, string>) };
    if (scripts.apply) {
      scripts.deploy = scripts.apply.replace("apply", "deploy");
      delete scripts.apply;
    }
    return { ...pkg, scripts };
  },
  ctx.dryRun,
);
```

The mutator returns `null` to signal no change. If the serialized output
matches the original file content, `changed` is `false`.

### `createWarningRule(meta, scanSource)` (from rule-helpers.ts)

Create a rule that scans files and emits warnings without modifying them.
The scan function receives `(source, file)` and returns `string`, `string[]`,
or `null`. The returned `WarningRule` exposes `scanSource` for testing.

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
3. **Is the target a common property name that must be scoped to a specific context?**
   - Yes → `renamePropertyInPattern` (renames only within pattern matches)
4. **Does the migration involve both a method rename AND a property rename?**
   - Yes → Hybrid: `applyPatternReplace` for method + `renameIdentifiers` for property
5. **Is the target a property access in a chain** (e.g., `context.user.attributes`)?
   - Yes → `renamePropertyAccess` (handles both `.` and `?.` access)
6. **Do function arguments need restructuring?**
   - Tuple-to-call conversion → `transformTupleArgsToCall` (mapping table + auto import list)
   - Other restructuring → `transformCallArguments` (receives parsed args, returns new arg string)
   - Complex cases → `applyPatternReplace` with `$$$ARGS` + `getArgs`
7. **Does a property value need to be replaced (not the key)?**
   - Yes → `replacePropertyValue` with replacer function
8. **Does a nested property need renaming at a specific path?**
   - Yes → `renamePropertyAtPath` (dot-separated path to target)
9. **Does a property need to be added to or removed from an object?**
   - Add → `addProperty` with pattern match
   - Remove → `removeProperty` with pattern match
10. **Does an expression need to be wrapped?**
    - Yes → `wrapExpression` with `$EXPR` placeholder
11. **Does an import specifier need to be added, removed, or renamed?**
    - Add → `addImportSpecifier`
    - Remove → `removeImportSpecifier`
    - Rename (import only, not body) → `renameImportSpecifier`
12. **Is the target a string literal** (e.g. import path)?
    - Yes → `source.includes()` + `replaceAll` (AST helpers don't match strings)
13. **Is the change behavior-only (no code fix, just warn)?**
    - Yes → `createWarningRule` (emits warnings without modifying files)
14. **Does the rule need to scan non-TypeScript files?**
    - Yes → Set `filePatterns` on the rule metadata
15. **Does the rule need to transform JSON files** (e.g., package.json)?
    - Yes → Use `transformJsonFile` in a manual rule (JSON is not AST-parsed)

## Common Patterns

### Simple identifier/property rename (most common)

Use `renameIdentifiers` with `createRule`. Works for function names,
variables, import specifiers, and object property keys:

```typescript
import { renameIdentifiers } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const myRenameRule = createRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
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
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
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
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
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
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
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

### Context-limited property rename (high false-positive names)

When a property name like `attributes` is too common for global rename,
use `renamePropertyInPattern` to scope the rename to a specific call:

```typescript
import { renamePropertyInPattern } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const authAttributesRule = createRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    const { output, count } = renamePropertyInPattern(
      source,
      "defineAuth($$$ARGS)",
      "attributes",
      "map",
    );
    return count > 0 && output !== source ? output : null;
  },
);
```

This renames `attributes` only inside `defineAuth(...)` calls, leaving
global `attributes` variables untouched.

### Import specifier manipulation

Use `renameImportSpecifier`, `removeImportSpecifier`, and
`addImportSpecifier` to modify import statements precisely.

```typescript
import { addImportSpecifier, removeImportSpecifier } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const migrateImportsRule = createRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    let result = source;
    let changed = false;

    // Remove old import
    const r1 = removeImportSpecifier(result, "defineGenerators", "@tailor-platform/sdk");
    if (r1.count > 0) {
      result = r1.output;
      changed = true;
    }

    // Add new import
    const r2 = addImportSpecifier(result, "definePlugins", "@tailor-platform/sdk");
    if (r2.count > 0) {
      result = r2.output;
      changed = true;
    }

    return changed ? result : null;
  },
);
```

`renameImportSpecifier(source, oldName, newName, moduleSpecifier?)` renames
a specifier only within import declarations (not in code body). Useful when
the import name changes but usage is handled by a separate rename pass.

### Structural changes (add/remove object properties)

Use `removeProperty` and `addProperty` for object restructuring within
pattern matches:

```typescript
import { addProperty, removeProperty } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const configMigrationRule = createRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    let result = source;
    let changed = false;

    // Remove deprecated property
    const r1 = removeProperty(result, "defineConfig($$$ARGS)", "legacyOption");
    if (r1.count > 0 && r1.output !== result) {
      result = r1.output;
      changed = true;
    }

    // Add new required property
    const r2 = addProperty(result, "defineConfig($$$ARGS)", "newOption", "true");
    if (r2.count > 0 && r2.output !== result) {
      result = r2.output;
      changed = true;
    }

    return changed ? result : null;
  },
);
```

### Expression wrapping

Use `wrapExpression` to wrap matched expressions in a template.
`$EXPR` in the template is replaced with the matched text:

```typescript
import { wrapExpression } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const wrapWithMiddlewareRule = createRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    const { output, count } = wrapExpression(
      source,
      "createResolver($$$ARGS)",
      "withMiddleware($EXPR)",
    );
    return count > 0 ? output : null;
  },
);
```

### Import path rename (string literal)

For import path changes, AST helpers don't match string literals. Use
`source.includes()` + `replaceAll`:

```typescript
import { createRule } from "../../rule-helpers";

export const importPathRule = createRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    if (!source.includes("@tailor-platform/sdk/tailordb")) return null;
    return source.replaceAll("@tailor-platform/sdk/tailordb", "@tailor-platform/sdk/schema");
  },
);
```

### Warning-only rule (behavior changes, deprecation notices)

For changes that cannot be automated but need user attention, use
`createWarningRule`. It scans files without modifying them:

```typescript
import { findIdentifiers } from "../../codemod-engine";
import { createWarningRule } from "../../rule-helpers";

export const updatedAtDefaultRule = createWarningRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source, file) => {
    const matches = findIdentifiers(source, "timestamps");
    if (matches.length > 0) {
      return `${file}: updatedAt now defaults to current time on creation. Review timestamp behavior.`;
    }
    return null; // no warning for this file
  },
);
```

The scan function can return a single string, an array of strings, or
null. The returned `WarningRule` exposes `scanSource` for direct testing.

### Property access rename (dot and optional chain)

Use `renamePropertyAccess` to rename a property in member access chains,
handling both `.prop` and `?.prop` access. Scoped by receiver pattern:

```typescript
import { renamePropertyAccess } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const contextAttributesRule = createRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    // Renames context.user.attributes and context.user.attributes?.role
    // but NOT element.attributes
    const { output, count } = renamePropertyAccess(
      source,
      "$A.user", // receiver pattern
      "attributes", // old property name
      "map", // new property name
    );
    return count > 0 ? output : null;
  },
);
```

### Tuple-to-call argument transformation (generator to plugin)

Use `transformTupleArgsToCall` with `addImportSpecifier` for converting
tuple-based arguments to function calls using a mapping table:

```typescript
import {
  addImportSpecifier,
  renameIdentifiers,
  transformTupleArgsToCall,
} from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

const pluginMappings = [
  {
    packageName: "@tailor-platform/kysely-type",
    functionName: "kyselyTypePlugin",
    importPath: "@tailor-platform/sdk/plugin/kysely-type",
  },
  {
    packageName: "@tailor-platform/enum-constants",
    functionName: "enumConstantsPlugin",
    importPath: "@tailor-platform/sdk/plugin/enum-constants",
  },
];

export const generatorsToPluginsRule = createRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    let result = source;
    let changed = false;

    // Transform tuple arguments to function calls
    const r1 = transformTupleArgsToCall(result, "defineGenerators", pluginMappings);
    if (r1.count > 0) {
      result = r1.output;
      changed = true;

      // Add required imports
      for (const imp of r1.imports) {
        const r = addImportSpecifier(result, imp.specifier, imp.path);
        result = r.output;
      }
    }

    // Rename the function and variable
    const r2 = renameIdentifiers(result, "defineGenerators", "definePlugins");
    if (r2.count > 0) {
      result = r2.output;
      changed = true;
    }

    return changed ? result : null;
  },
);
```

### Function argument restructuring (general)

Use `transformCallArguments` for custom argument restructuring logic:

### Property value replacement

Use `replacePropertyValue` when a property value needs to change but the
key stays the same:

```typescript
import { replacePropertyValue } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const handlerMigrationRule = createRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    const { output, count } = replacePropertyValue(
      source,
      "config($$$ARGS)",
      "handler",
      (valueNode) => `wrapHandler(${valueNode.text()})`,
    );
    return count > 0 && output !== source ? output : null;
  },
);
```

### Nested property rename (path-targeted)

Use `renamePropertyAtPath` when a property rename must be scoped to a
specific nesting path to avoid false positives:

```typescript
import { renamePropertyAtPath } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const authAttributesRule = createRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    const { output, count } = renamePropertyAtPath(
      source,
      "defineAuth($$$ARGS)",
      "userProfile", // navigate to userProfile first
      "attributes", // then rename this property
      "map",
    );
    return count > 0 && output !== source ? output : null;
  },
);
```

### JSON file transformation (package.json, etc.)

Use `transformJsonFile` in a manual rule for JSON file changes. Since JSON
isn't AST-parsed, this uses `JSON.parse`/`JSON.stringify`:

```typescript
import { transformJsonFile } from "../../codemod-engine";
import type { FileDiff, MigrationRule } from "../../types";

export const packageJsonRule: MigrationRule = {
  id: "v2/my-rule",
  name: "...",
  description: "...",
  since: "1.0.0",
  until: "2.0.0",
  filePatterns: ["**/package.json"],
  async transform(ctx) {
    const filesModified: string[] = [];
    const diffs: FileDiff[] = [];

    for (const file of ctx.files) {
      const result = await transformJsonFile(
        file,
        (parsed) => {
          const pkg = parsed as Record<string, unknown>;
          const scripts = { ...(pkg.scripts as Record<string, string> | undefined) };
          if (!scripts?.apply) return null;
          scripts.deploy = scripts.apply.replace("apply", "deploy");
          delete scripts.apply;
          return { ...pkg, scripts };
        },
        ctx.dryRun,
      );

      if (result.changed) {
        filesModified.push(file);
        if (result.before && result.after) {
          diffs.push({ file, before: result.before, after: result.after });
        }
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

### Non-TypeScript file rules (scripts, CI configs)

Rules that need to scan non-TypeScript files set `filePatterns`:

```typescript
import { createRule } from "../../rule-helpers";

export const cliCommandRenameRule = createRule(
  {
    id: "v2/my-rule",
    name: "...",
    description: "...",
    since: "1.0.0",
    until: "2.0.0",
    filePatterns: ["**/*.sh", "**/*.yml", "**/*.yaml"],
  },
  (source) => {
    if (!source.includes("tailor-sdk apply")) return null;
    return source.replaceAll("tailor-sdk apply", "tailor-sdk deploy");
  },
);
```

Default patterns (`**/*.{ts,tsx,mts,cts}`) apply when `filePatterns` is
omitted. The `node_modules`, `dist`, and `.git` exclusions always apply.

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

| Risk level | Name characteristics                                                    | Strategy                                                                         |
| ---------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Low        | Long, domain-specific (e.g. `recordCreatedTrigger`, `defineGenerators`) | `renameIdentifiers` or `batchRename`                                             |
| Medium     | Short but scoped to a context (e.g. `type` as a method name)            | `applyPatternReplace` with receiver guard                                        |
| High       | Common word in property access (e.g. `attributes` in `context.user`)    | `renamePropertyAccess` with receiver pattern                                     |
| High       | Common word scoped to specific calls (e.g. `attributes` in auth config) | `renamePropertyInPattern` (scopes rename to pattern matches only)                |
| Very High  | Common word in many contexts (e.g. `name`, `value`)                     | `applyPatternReplace` with narrow AST pattern + manual replacer; avoid any `All` |

## Rule Ordering

Rules within a version array execute sequentially in registration order.

- **Independent rules** (touching different identifiers/properties) can be
  in any order. Append new rules to the end of the array for minimal diffs.
- **`batchRename` handles substring conflicts internally** by sorting
  longest-first, so ordering within a batch is automatic.
- When adding a new rule, check existing rules in the version array for
  potential interactions (e.g., rule A renames an identifier that rule B
  also references). If rule B depends on rule A's output, place A first.
