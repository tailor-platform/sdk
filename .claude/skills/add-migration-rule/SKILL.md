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

**Important:** `replaceAll` transforms comments and string literals too.
If `input.ts` contains the target identifier in a comment (e.g.,
`// Uses retryPolicy`), the `output.ts` must reflect the replacement
(e.g., `// Uses retry`). Mismatched comments are the most common cause
of fixture test failures.

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

**Important:** `$$$NAME` captures include comma separator nodes. Always filter
them out: `.filter((n) => n.kind() !== ",")` before `.map()`. Failing to do
this produces `"a, ,, b"` instead of `"a, b"`.

### `transformFile(filePath, transformFn, dryRun)`

Read file, apply `transformFn(source)`, write back if changed. Returns boolean.
`transformFn` should return `null` or the original source if no changes.

### `findPattern(source, pattern, lang?)`

Search-only variant. Returns array of matched `SgNode` without modification.

**Caveat:** `findPattern` matches `identifier` AST nodes but NOT
`property_identifier` nodes. Object property keys like `publishEvents` in
`{ publishEvents: true }` are `property_identifier` in the TypeScript AST,
so `findPattern(source, "publishEvents")` returns zero matches. Use
`source.includes("publishEvents")` instead for property-name detection
(see "Object property rename" pattern below).

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

1. **Is the target an identifier** (function name, variable, import specifier)?
   - Yes, and it is **unique/domain-specific** (e.g. `defineGenerators`) →
     Simple identifier rename (`findPattern` + `replaceAll`)
   - Yes, but it is **ambiguous** (e.g. `type` as a method name) →
     Receiver-guarded method rename (`applyPatternReplace` with guard)
2. **Is the target an object property key** (e.g. `{ retryPolicy: ... }`)?
   - Yes → Object property rename (`source.includes` + `replaceAll`)
3. **Does the migration involve both identifiers AND property keys?**
   - Yes → Hybrid pattern (AST pass + string pass)
4. **Do function arguments need restructuring?**
   - Yes → Argument restructuring (`applyPatternReplace` with `$$$ARGS`)

## Common Patterns

### Simple identifier rename (recommended for function/variable renames)

When the old and new names are unique identifiers used as function names,
variable names, or import specifiers (i.e., `identifier` AST nodes), use
`findPattern` to confirm AST-level presence, then `replaceAll` to preserve
formatting:

```typescript
const matches = findPattern(source, "oldName");
if (matches.length === 0) return null;
return source.replaceAll("oldName", "newName");
```

This handles both imports and call sites in one pass without losing
semicolons, indentation, or trailing commas.

### Batch identifier rename (multiple renames in one rule)

When several related identifiers are renamed together (e.g., a family of
trigger functions), use a `Map` and loop instead of writing separate rules:

```typescript
const renames = new Map([
  ["oldNameA", "newNameA"],
  ["oldNameB", "newNameB"],
  ["oldNameC", "newNameC"],
]);

(source) => {
  let result = source;
  let totalChanged = 0;

  for (const [oldName, newName] of renames) {
    const matches = findPattern(result, oldName);
    if (matches.length > 0) {
      result = result.replaceAll(oldName, newName);
      totalChanged += matches.length;
    }
  }

  return totalChanged > 0 ? result : null;
};
```

Each iteration re-parses the updated source, so later renames see the
result of earlier ones. This is safe as long as no old name is a substring
of another old name or of a new name. When substring conflicts exist,
order Map entries with **longer names first** to prevent partial matches:

```typescript
// WRONG: "createWorkflow" matches inside "createWorkflowJob"
new Map([
  ["createWorkflow", "defineWorkflow"], // ← replaces part of createWorkflowJob
  ["createWorkflowJob", "defineWorkflowJob"], // ← never matches (already corrupted)
]);

// CORRECT: process longer name first
new Map([
  ["createWorkflowJob", "defineWorkflowJob"], // ← exact match first
  ["createWorkflow", "defineWorkflow"], // ← safe, no substring left
]);
```

### Object property rename

When renaming an object property key (e.g., `publishEvents` in
`{ publishEvents: true }`), `findPattern` does NOT work because property
keys are `property_identifier` nodes in the AST, not `identifier` nodes.
Use `source.includes()` as the guard instead:

```typescript
if (!source.includes("oldProp")) return null;
return source.replaceAll("oldProp", "newProp");
```

This is safe when the property name is sufficiently unique (no false matches
in unrelated code). For ambiguous names, combine with `applyPatternReplace`
using a member-access or call-expression pattern to narrow the scope.

### Receiver-guarded method rename

When renaming a method on a specific object (e.g., `db.type()` to
`db.model()`) but the pattern `$OBJ.type($$$ARGS)` could also match
unrelated objects, add a receiver guard in the replacer:

```typescript
applyPatternReplace(source, "$OBJ.type($$$ARGS)", (node) => {
  const obj = node.getMatch("OBJ")!.text();
  // Only transform calls on "db", skip anything else
  if (obj !== "db") return node.text();
  const args = node
    .getMultipleMatches("ARGS")
    .filter((n) => n.kind() !== ",")
    .map((n) => n.text());
  return `${obj}.model(${args.join(", ")})`;
});
```

Returning `node.text()` (the original text) when the guard fails produces
zero net change for that match, so `count` still increments but the output
is unchanged. This is harmless because the file-level `changed` check
compares the final output to the original source.

### Restructure function call arguments

When you need to transform arguments (not just rename):

```typescript
applyPatternReplace(source, "oldFn($$$ARGS)", (node) => {
  const args = node
    .getMultipleMatches("ARGS")
    .filter((n) => n.kind() !== ",") // IMPORTANT: filter comma nodes
    .map((n) => n.text());
  return `newFn(${args.join(", ")})`;
});
```

**Note:** `applyPatternReplace` replaces the matched AST range with the
returned string. Surrounding code (semicolons, trailing commas) outside the
match is preserved, but content inside (indentation, line breaks) is lost.
For formatting-sensitive transforms, prefer the simple rename pattern above.

### Hybrid: AST method rename + string property rename

When a migration involves both a method call rename (AST-matchable) and a
property key rename (not AST-matchable), combine both approaches in a
two-pass transform:

```typescript
(source) => {
  let result = source;
  let totalChanged = 0;

  // Pass 1: Rename method calls using AST matching
  const pass1 = applyPatternReplace(result, "$OBJ.oldMethod($$$ARGS)", (node) => {
    const obj = node.getMatch("OBJ")!.text();
    const args = node
      .getMultipleMatches("ARGS")
      .filter((n) => n.kind() !== ",")
      .map((n) => n.text());
    return `${obj}.newMethod(${args.join(", ")})`;
  });
  result = pass1.output;
  totalChanged += pass1.count;

  // Pass 2: Rename property key using string matching
  if (result.includes("oldProp")) {
    result = result.replaceAll("oldProp", "newProp");
    totalChanged++;
  }

  return totalChanged > 0 ? result : null;
};
```

### Add a warning for manual attention

When a pattern cannot be fully auto-migrated:

```typescript
const matches = findPattern(source, "<pattern>");
if (matches.length > 0) {
  warnings.push(
    `${file}: Found ${matches.length} occurrences of <X> that require manual migration`,
  );
}
```

## False Positive Risk

`replaceAll` operates on raw strings, so it can match inside string
literals, comments, and unrelated identifiers. Assess the risk before
choosing a strategy:

| Risk level | Name characteristics                                                    | Strategy                                                                         |
| ---------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Low        | Long, domain-specific (e.g. `recordCreatedTrigger`, `defineGenerators`) | `findPattern` guard + `replaceAll` is safe                                       |
| Medium     | Short but scoped to a context (e.g. `type` as a method name)            | Use `applyPatternReplace` with a receiver guard                                  |
| High       | Common word that appears in many contexts (e.g. `name`, `value`)        | Use `applyPatternReplace` with a narrow AST pattern; avoid `replaceAll` entirely |

When in doubt, search the `example/` directory for occurrences of the old
name to estimate false positive frequency.

## Rule Ordering

Rules within a version array execute sequentially in registration order.
Keep these guidelines in mind:

- **Independent rules** (touching different identifiers/properties) can be
  in any order.
- **Overlapping rules** (targeting the same files or related identifiers)
  should be ordered so that earlier rules do not interfere with later ones.
  For example, if rule A renames `db.type()` to `db.model()` and rule B
  renames the import path `@tailor-platform/sdk/tailordb`, the order does
  not matter because they touch different parts of the source. But if rule A
  renames `foo` to `bar` and rule B renames `fooBar` to `bazBar`, rule A
  must run second (or use AST matching instead of `replaceAll`) to avoid
  corrupting `fooBar` into `barBar`.
- When adding a new rule, check existing rules in the version array for
  substring conflicts with your old/new names.
