# Wire defineIdp's provider() factory into defineAuth.idProvider

## Goal

Connect the project's IdP definition to the auth service's `idProvider` field
by using the IdP's provider factory — not by writing the underlying provider
object by hand.

## Domain Context

Each Tailor IdP exposes a `provider(...)` method that returns a normalized
`BuiltinIdP` object referencing the IdP's namespace and a specific OAuth2
client name registered with that IdP. This indirection enforces that the
client name used in auth matches one of the IdP's declared clients at the type
level. Writing the provider object literally bypasses that safeguard and is
brittle to IdP renames.

## What to Build

Edit `tailor.config.ts` so that:

1. `defineIdp("my-idp", { clients: ["default-idp-client"], permission })` keeps
   its current shape.
2. `defineAuth("my-auth", { ... })` populates `idProvider` by calling the IdP
   instance's `provider()` factory with provider name `"primary"` and client
   name `"default-idp-client"`.
3. The IdP is also wired into `defineConfig({ idp: [idp] })`.

The auth's `machineUserAttributes` / `machineUsers` blocks are already in
place — leave them as-is.

## Requirements

- Reuse the existing `idp` constant when populating `auth.idProvider`. Do not
  build the `BuiltinIdP` object literally or import its type.
- The provider name passed to `idp.provider(...)` must be `"primary"`.
- The client name passed to `idp.provider(...)` must match the IdP's declared
  client list (`"default-idp-client"`).
- Keep the rest of the configuration (auth machine user, `db.tailordb.files`)
  unchanged.

## Reference

Refer to the installed SDK package for the IdP provider factory signature and
the auth configuration shape. No external documentation is required for this
task.
