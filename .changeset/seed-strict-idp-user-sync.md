---
"@tailor-platform/sdk": minor
---

Add `strictIdpUserSync` option to `seedPlugin` for opting out of the
userProfile → `_User` foreign key.

The seed plugin generates a foreign key from the userProfile type (e.g. `User`)
to `_User` so that `validate` rejects userProfile rows without a matching
`_User` row. This is helpful when the seed is expected to keep both tables in
sync, but it makes it impossible to seed pre-registration states such as
invited-but-not-registered users, where the TailorDB row exists before the
IdP credential.

The new `strictIdpUserSync` option defaults to `true` (existing behavior).
Set it to `false` in `tailor.config.ts` to skip emitting the
userProfile → `_User` foreign key:

```ts
seedPlugin({
  distPath: "./seed",
  machineUserName: "admin",
  strictIdpUserSync: false,
}),
```

The `_User` → userProfile foreign key is always emitted, so creating an IdP
user without a matching userProfile row continues to be rejected.
