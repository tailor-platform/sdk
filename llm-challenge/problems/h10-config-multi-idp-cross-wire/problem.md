# Wire defineAuth.idProvider to the correct IdP across two defineIdp definitions

## Goal

Configure a Tailor app that defines **two** IdP namespaces (`staff-idp` and
`customer-idp`), each with its own OAuth2 client list, and wire the
`defineAuth(...)` service so its `idProvider` references the **staff** IdP
through that IdP's own `provider()` factory.

## Domain Context

Multi-tenant deployments often expose two parallel identity domains: an
internal staff IdP and a public customer IdP. Each IdP declares its own client
list, and the auth service's `idProvider` must point at one specific IdP. The
SDK only enforces the matching client-name constraint at the type level
through each IdP's `provider()` factory — building a `BuiltinIdP` object by
hand (or calling `provider()` on the wrong IdP instance) compiles but
silently binds the auth service to the unintended namespace.

## What to Build

Author `tailor.config.ts` from scratch so that it:

1. Defines two IdPs:
   - `defineIdp("staff-idp", { clients: ["staff-portal"], permission })`
   - `defineIdp("customer-idp", { clients: ["customer-app"], permission })`
2. Defines a single `defineAuth("my-auth", { ... })` whose `idProvider` is
   produced by **the staff IdP's** `provider("primary", "staff-portal")`
   factory — not by writing a `BuiltinIdP` object literal and not by calling
   `customer-idp`'s `provider()` with a staff client name.
3. Registers both IdPs in `defineConfig({ idp: [staffIdp, customerIdp], auth })`.

The `auth` config must use a `machineUsers` entry called `"runner"` (no
`userProfile`) so the SDK accepts the configuration without a user profile.

## Requirements

- Reuse the IdP constants when populating `auth.idProvider`. Do not build the
  `BuiltinIdP` object literally or import its type.
- The provider name passed to `idp.provider(...)` must be `"primary"`.
- The client name passed to `idp.provider(...)` must be `"staff-portal"` and
  must come from the staff IdP's `clients` array — calling
  `customerIdp.provider("primary", "staff-portal")` would not typecheck.
- Keep the `defineConfig({ ... })` default export and include
  `db.tailordb.files: ["./tailordb/*.ts"]`.

## Reference

Refer to the installed SDK package for the IdP provider factory signature, the
auth configuration shape, and the application config (`AppConfig`) shape. No
external documentation is required for this task.
