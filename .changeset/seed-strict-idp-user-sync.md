---
"@tailor-platform/sdk": minor
---

Add `strictIdpUserSync` option to `seedPlugin` for opting out of the
`_User <-> userProfile` foreign keys emitted into the generated seed schema.

The seed plugin emits two foreign keys when `auth.userProfile` is configured
so that `validate` rejects rows on either side that lack a matching
counterpart:

- `_User.name → <userProfile>.<usernameField>` (`idpToUser`)
- `<userProfile>.<usernameField> → _User.name` (`userToIdp`)

Both default to `true`, matching the previous behavior. Neither direction is
enforced by the runtime, so it can be useful to relax one or both when
seeding asymmetric production-like states such as invited-but-not-registered
users.

Boolean shorthand toggles both directions together, while the object form
controls each direction individually:

```ts
// Disable both directions
seedPlugin({
  distPath: "./seed",
  strictIdpUserSync: false,
}),

// Allow seeding invited userProfile rows without a _User row
seedPlugin({
  distPath: "./seed",
  strictIdpUserSync: { userToIdp: false },
}),

// Allow seeding _User rows whose userProfile row does not exist yet
seedPlugin({
  distPath: "./seed",
  strictIdpUserSync: { idpToUser: false },
}),
```
