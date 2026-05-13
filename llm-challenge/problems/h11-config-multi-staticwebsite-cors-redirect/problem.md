# Wire CORS and OAuth2 redirect URIs across two static websites without cross-mixing origins

## Goal

Configure a Tailor app that serves two distinct frontends from two static
websites (`admin-frontend` and `public-frontend`) and binds each frontend's
deployment URL to its **own** OAuth2 client redirect URI while still allowing
both origins through CORS.

## Domain Context

When a backend serves more than one SPA, each frontend ships its own OAuth2
client with its own redirect URI. The deployment URL of each frontend only
becomes known at deploy time, so the configuration must reference each website
through the SDK's deferred placeholder rather than a literal string. Mixing the
two placeholders — for example reusing `admin.url` inside the public client's
redirect — silently routes login flows to the wrong origin.

## What to Build

Author `tailor.config.ts` from scratch so that it:

1. Defines two static websites:
   - `defineStaticWebSite("admin-frontend", { description })`
   - `defineStaticWebSite("public-frontend", { description })`
2. Defines a single `defineAuth("my-auth", { ... })` with two OAuth2 clients:
   - `admin`: `redirectURIs: ["${adminSite.url}/callback"]`
   - `public`: `redirectURIs: ["${publicSite.url}/callback"]`
3. Sets the application's CORS allow-list to **both** website URLs.
4. Exports a `defineConfig(...)` default whose `staticWebsites` includes both
   websites, whose `auth` is the auth above, whose `name` is
   `"micro-challenge"`, and whose `db.tailordb.files` continues to glob
   `"./tailordb/*.ts"`.

The `auth` config must use a `machineUsers` entry called `"runner"` (no
`userProfile`) so the SDK accepts the configuration without a user profile.

## Requirements

- Each redirect URI must derive from **its own** `defineStaticWebSite(...)`
  instance — no duplicated string literals and no cross-wired placeholders.
- Each redirect URI must include the `/callback` path suffix.
- The CORS array must contain exactly the two static-website URLs (order does
  not matter).
- Do not embed a hard-coded host like `"https://example.com"` anywhere.

## Reference

Refer to the installed SDK package for the static website, OAuth2 client, and
auth configuration shapes. The `defineStaticWebSite(name, ...)` factory's
`.url` getter returns `` `${name}:url` `` as a deferred placeholder. No
external documentation is required for this task.
