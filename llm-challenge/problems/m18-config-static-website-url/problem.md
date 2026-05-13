# Reuse a static website URL across CORS and OAuth2 redirect URIs

## Goal

Configure a Tailor app whose CORS allow-list and OAuth2 client redirect URI both
point at the same static website, **without** hard-coding the deployment URL.
The deployment URL only becomes known at deploy time, so the configuration must
reference the website through the SDK's deferred placeholder instead of a
literal string.

## Domain Context

Single-page apps frequently authenticate against the same backend that serves
them. The frontend's origin therefore has to be allow-listed in CORS, and the
OAuth2 callback for that frontend has to be registered as a redirect URI. When
both references derive from one static website definition, they must stay in
sync automatically if the website is renamed or replaced.

## What to Build

Author `tailor.config.ts` from scratch so that it:

1. Defines a static website named `"my-frontend"` (any non-empty description
   is fine).
2. Configures a single OAuth2 client called `"web"` whose redirect URI for
   `/callback` is anchored at the static website's deployment URL.
3. Sets the application's CORS allow-list to that same deployment URL.
4. Exports a `defineConfig(...)` default whose `name` is `"micro-challenge"`,
   whose `staticWebsites` includes the website, whose `auth` is wired to a
   `defineAuth(...)` machine-user configuration named `"my-auth"`, and whose
   `db.tailordb.files` continues to glob `"./tailordb/*.ts"`.

The `auth` config must use a `machineUsers` entry called `"runner"` (no
`userProfile`), so the SDK accepts the configuration without a user profile.

## Requirements

- The CORS entry and the OAuth2 redirect URI must both derive from the same
  `defineStaticWebSite(...)` instance — no duplicated string literals.
- Do not embed a hard-coded host like `"https://example.com"` anywhere.
- The redirect URI must include the `/callback` path suffix.
- Use a default export for `defineConfig(...)`.

## Reference

Refer to the installed SDK package for the static website, OAuth2 client, and
auth configuration shapes. No external documentation is required for this task.
