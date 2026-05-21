# Wire the auth service's identity provider to the correct IdP across two IdP definitions

## Goal

Configure a Tailor app that defines **two** IdP namespaces (`staff-idp` and
`customer-idp`), each with its own OAuth2 client list, and wire the auth
service so its identity-provider reference points at the **staff** IdP through
that IdP's own provider factory.

## Domain Context

Multi-tenant deployments often expose two parallel identity domains: an
internal staff IdP and a public customer IdP. Each IdP declares its own client
list, and the auth service's identity-provider field must point at one
specific IdP. The SDK only enforces the matching client-name constraint at the
type level through each IdP instance's `provider()` factory — building the
underlying identity-provider object by hand (or calling `provider()` on the
wrong IdP instance) compiles but silently binds the auth service to the
unintended namespace.

## What to Build

Author `tailor.config.ts` from scratch so that it:

1. Defines two IdPs using the SDK's IdP factory (exported from
   `@tailor-platform/sdk`), one per identity namespace:
   - `"staff-idp"` with `clients: ["staff-portal"]`,
   - `"customer-idp"` with `clients: ["customer-app"]`.

   Hold each factory's return value in a local binding (e.g. `staffIdp`,
   `customerIdp`) so the auth wiring below can reference them by identity.

2. Defines a single auth service via the SDK's auth factory (exported from
   `@tailor-platform/sdk`) whose identity-provider reference is produced by
   **the staff IdP's** `provider("primary", "staff-portal")` call — not by
   writing the underlying identity-provider object literally and not by
   calling `provider()` on the customer IdP with a staff client name.
3. Registers both IdPs in the application config so they are discoverable at
   deploy time, and wires the auth service into the same config.

The auth config must use a `machineUsers` entry called `"runner"` (no
`userProfile`) so the SDK accepts the configuration without a user profile.

## Requirements

- Reuse the IdP constants when populating the auth service's identity-provider
  field. Do not construct the underlying identity-provider object literally
  and do not import its type.
- The provider name passed to `<idp>.provider(...)` must be `"primary"`.
- The client name passed to `<idp>.provider(...)` must be `"staff-portal"` and
  must come from the **staff** IdP's `clients` array — calling
  `customerIdp.provider("primary", "staff-portal")` would not typecheck.
- Keep the app config exported as `default` and include
  `db.tailordb.files: ["./tailordb/*.ts"]`.

## Reference

Refer to the installed SDK package for the IdP factory, the auth factory's
identity-provider field shape, and the application config shape. No external
documentation is required for this task.
