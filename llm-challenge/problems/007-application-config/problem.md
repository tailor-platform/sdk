# Application Config with Cross-References

## Overview

Build a complete application configuration for a multi-tenant SaaS platform using the Tailor Platform SDK. This challenge focuses on wiring together multiple services (static websites, IDP, auth, generators) with correct cross-references between them. You must define a single `tailor.config.ts` that ties everything together.

## Requirements

Implement `tailor.config.ts` with the following components. Scaffold files `tailordb/user.ts` and `tailordb/tenant.ts` are provided and must not be modified.

### 1. Static Websites

Define **2 static websites**:

- A **dashboard** application (name must contain `"dashboard"`)
- A **documentation** site (name must contain `"docs"`)

### 2. Identity Provider (IDP)

Define an IDP with the following password policy:

| Policy                           | Value |
| -------------------------------- | ----- |
| `useNonEmailIdentifier`          | false |
| `allowSelfPasswordReset`         | true  |
| `passwordRequireUppercase`       | true  |
| `passwordRequireLowercase`       | true  |
| `passwordRequireNonAlphanumeric` | true  |
| `passwordRequireNumeric`         | true  |
| `passwordMinLength`              | >= 8  |
| `passwordMaxLength`              | 128   |

- Authorization: `"loggedIn"`
- Clients: `["default-idp-client"]`

### 3. Auth

Define an auth service with:

- **userProfile**: Reference the `User` model (imported from `./tailordb/user`), using `"email"` as the username field, with `role` as an attribute.
- **machineUsers**: Exactly **3 machine users** with different roles:
  - One with `role: "ADMIN"`
  - One with `role: "WORKER"`
  - One with `role: "READONLY"`
- **oauth2Clients**: Exactly **2 OAuth2 clients**:
  - A **dashboard client** (key must contain `"dashboard"`): **2 redirect URIs** using the dashboard website URL (e.g., `${dashboard.url}/callback` and `${dashboard.url}/auth/redirect`)
  - A **docs client** (key must contain `"docs"`): **1 redirect URI** using the docs website URL (e.g., `${docs.url}/callback`)
- **idProvider**: Created from the IDP's `.provider()` method

### 4. Config

Wire all services into `defineConfig()`:

| Field            | Value                                      |
| ---------------- | ------------------------------------------ |
| `name`           | `"challenge-007"`                          |
| `cors`           | Both website URLs (2 entries)              |
| `db.tailordb`    | Files: `["./tailordb/*.ts"]`               |
| `resolver`       | At least one resolver namespace with files |
| `executor`       | Files array                                |
| `workflow`       | Files array                                |
| `auth`           | The defined auth service                   |
| `idp`            | Array containing the defined IDP           |
| `staticWebsites` | Array containing both websites             |

### 5. Generators

Export a named `generators` constant using `defineGenerators()` with exactly **2 generators**:

1. `@tailor-platform/kysely-type` with a `distPath`
2. `@tailor-platform/seed` with a `distPath` and a `machineUserName` that matches one of the defined machine users

### Cross-Reference Rules

- OAuth2 client redirect URIs **must** start with the corresponding website's URL
- CORS entries **must** match the website URLs
- The seed generator's `machineUserName` **must** be one of the machine user names defined in auth

## Scaffold

Two TailorDB model files are provided:

- `tailordb/user.ts` - User model with name, email, role fields
- `tailordb/tenant.ts` - Tenant model with name, slug, plan fields

## Hints

- All config functions (`defineConfig`, `defineAuth`, `defineIdp`, `defineStaticWebSite`, `defineGenerators`) are imported from `@tailor-platform/sdk`
- `defineStaticWebSite` returns an object with a `.url` property (resolved at deploy time) — use this for CORS and redirect URIs
- `defineIdp` returns an object with a `.provider()` method for creating auth providers
- `defineGenerators` takes tuples as rest arguments: `defineGenerators(["package-name", { options }], ...)`
- Machine user attribute values must match the model's enum field values
- Refer to `example/tailor.config.ts` in the SDK repository for a working configuration
