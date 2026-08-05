---
"@tailor-platform/sdk": patch
---

Fix a resolver `permission` denial returning `ReferenceError: TailorErrorMessage is not defined` to the caller instead of `access denied`. The generated guard now raises `TailorErrors`, which is the only error class the platform turns back into a message the caller can read.

`TailorErrorMessage` no longer exists in the platform runtime, so its ambient global declaration and its Vitest mock are removed as well — together they let code that always failed in production pass both type checking and tests. Code that throws `TailorErrorMessage` now fails to compile; replace it with `TailorErrors`:

```ts
throw new TailorErrors([{ message: "not found", path: [] }]);
```
