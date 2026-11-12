---
"@tailor-platform/sdk": minor
"@tailor-platform/sdk-codemod": minor
---

`defineConfig()` now takes `idp` as a single IdP, `idp: myIdp`, or as a single external declaration, `idp: { name: "shared-idp", external: true }`. The array form, `idp: [myIdp]`, still works but is deprecated and will be removed in v3, where a config declares one IdP.

`tailor upgrade` runs the `v3/idp-array-to-single` codemod, which writes the IdP of a one-element array as the `idp` value itself and removes an empty array. An array with two or more IdPs has no mechanical replacement, so the codemod reports it for you to change by hand.

```ts
export default defineConfig({
  name: "backoffice",
  idp: backofficeIdp,
});
```
