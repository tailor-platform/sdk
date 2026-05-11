---
"@tailor-platform/sdk": minor
---

Add `disableIdpUserSync` option to `seedPlugin` for opting out of the
`_User <-> userProfile` foreign keys emitted into the generated seed schema.

The seed plugin emits two foreign keys when `auth.userProfile` is configured
so that `validate` rejects rows on either side that lack a matching
counterpart:

- `_User.name → <userProfile>.<usernameField>` (`idpToUser`)
- `<userProfile>.<usernameField> → _User.name` (`userToIdp`)

Both are emitted by default, matching the previous behavior. Neither
direction is enforced by the runtime, so it can be useful to relax one when
seeding asymmetric production-like states such as
invited-but-not-registered users.

```ts
// Allow seeding invited userProfile rows without a _User row
seedPlugin({
  distPath: "./seed",
  disableIdpUserSync: { userToIdp: true },
}),

// Allow seeding _User rows whose userProfile row does not exist yet
seedPlugin({
  distPath: "./seed",
  disableIdpUserSync: { idpToUser: true },
}),
```
