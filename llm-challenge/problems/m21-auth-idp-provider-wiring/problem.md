# Wire the IdP's provider factory into the auth service's identity-provider field

## Goal

Connect the project's IdP definition to the auth service's identity-provider
field by using the IdP instance's provider factory — not by writing the
underlying provider object by hand.

## Domain Context

Each Tailor IdP exposes a `provider(...)` method that returns a normalized
identity-provider reference scoped to the IdP's namespace and a specific OAuth2
client name registered with that IdP. This indirection enforces that the
client name used in auth matches one of the IdP's declared clients at the type
level. Writing the provider object literally bypasses that safeguard and is
brittle to IdP renames.

## What to Build

Edit `tailor.config.ts` so that:

1. The existing IdP definition for `"my-idp"` (declaring
   `clients: ["default-idp-client"]` and its permission block) keeps its
   current shape.
2. The auth service populates its identity-provider field by calling the IdP
   instance's `provider()` factory with provider name `"primary"` and client
   name `"default-idp-client"`.
3. The IdP is also registered in the application config's IdP list so it is
   discoverable at deploy time.

The auth's `machineUserAttributes` / `machineUsers` blocks are already in
place — leave them as-is.

## Requirements

- Reuse the existing IdP constant when populating the auth's identity-provider
  field. Do not construct the underlying identity-provider object literally
  and do not import its type.
- The provider name passed to `<idp>.provider(...)` must be `"primary"`.
- The client name passed to `<idp>.provider(...)` must match the IdP's declared
  client list (`"default-idp-client"`).
- Keep the rest of the configuration (auth machine user, `db.tailordb.files`)
  unchanged.

## Reference

Refer to the installed SDK package for the IdP factory's provider method
signature and the auth configuration shape. No external documentation is
required for this task.
