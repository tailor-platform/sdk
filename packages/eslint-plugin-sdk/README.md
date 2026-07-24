# @tailor-platform/eslint-plugin-sdk

Lint rules for applications built with `@tailor-platform/sdk`. The plugin uses the ESLint v9
plugin API and can run with either ESLint or Oxlint.

## Installation

Install the plugin with your linter:

```bash
pnpm add --save-dev @tailor-platform/eslint-plugin-sdk oxlint
```

## Oxlint

Add the plugin and its rules to `.oxlintrc.json`:

```json
{
  "jsPlugins": [
    {
      "name": "tailor-sdk",
      "specifier": "@tailor-platform/eslint-plugin-sdk"
    }
  ],
  "rules": {
    "tailor-sdk/no-api-prefix-in-path-pattern": "warn",
    "tailor-sdk/no-execute-script-arg-stringify": "warn",
    "tailor-sdk/no-unconditional-permit": "warn"
  }
}
```

Oxlint JavaScript plugins are currently alpha. These rules use syntax and import binding analysis
only; they do not require type-aware custom rule support.

## ESLint

Use the recommended flat config with ESLint v9 or later:

```js
import tailorSdk from "@tailor-platform/eslint-plugin-sdk";

export default [tailorSdk.configs.recommended];
```

## Rules

### `no-api-prefix-in-path-pattern` (warning)

HTTP adapter path patterns are matched after the platform's `/api` prefix.

Incorrect:

```ts
export default createHttpAdapter({
  pathPattern: "/api/orders/*",
});
```

Correct:

```ts
export default createHttpAdapter({
  pathPattern: "/orders/*",
});
```

### `no-execute-script-arg-stringify` (warning)

`executeScript`'s `arg` option is serialized internally, so passing an already-stringified value
double-encodes it.

Incorrect:

```ts
await executeScript({ ...opts, arg: JSON.stringify({ a: 1 }) });
```

Correct:

```ts
await executeScript({ ...opts, arg: { a: 1 } });
```

The rule follows `arg` through a `const` variable (including one holding the `JSON.stringify(...)`
call itself) to catch indirect forms, and recognizes named and namespace imports of `executeScript`
from `@tailor-platform/sdk/cli`.

### `no-unconditional-permit` (warning)

Permission entries with empty `conditions` and `permit: true` grant access to every request, as do
the `unsafeAllowAll*` constants. Use them only during local development.

Incorrect:

```ts
export default db.type("User", fields).permission({
  create: [{ conditions: [], permit: true }],
  // ...
});

export const defaultPermission = unsafeAllowAllTypePermission;
```

Correct:

```ts
export default db.type("User", fields).permission({
  create: [{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }],
  // ...
});
```

The rule checks `.permission()` / `.gqlPermission()` on `db.type()` chains and the `permission`
option of `defineIdp()`, including values defined as `const` in the same file.

The rules recognize named and namespace imports from `@tailor-platform/sdk`, including local import
aliases. Same-named functions imported from other packages are ignored.
