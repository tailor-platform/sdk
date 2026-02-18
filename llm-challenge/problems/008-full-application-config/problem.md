# 008: Full Application Configuration

## Goal

Create a comprehensive application configuration that wires together all major SDK configuration features: static websites, identity providers, authentication, generators, and the core config.

## Context

You are setting up a new application called `"challenge-008"`. Two database models (`User` and `Product`) are already defined. Your job is to create the central `tailor.config.ts` that ties everything together.

## Scaffold

### `tailordb/user.ts`

A `User` model with fields: `email` (string, unique), `name` (string), `role` (enum: admin, editor, viewer), plus timestamps.

### `tailordb/product.ts`

A `Product` model with fields: `name` (string), `price` (float), `sku` (string, unique), plus timestamps.

## Instructions

Create `tailor.config.ts` with the following configuration:

### Static Website

- Name: `"my-frontend"`
- Description: `"Frontend application"`

### Identity Provider

- Name: `"my-idp"`
- Authorization: `"loggedIn"`
- Clients: `["default-idp-client"]`

### Auth

Define auth with name `"my-auth"`:

- **userProfile**: reference the `user` model, usernameField `"email"`, attributes `{ role: true }`
- **machineUsers**: two entries:
  - `"admin-machine-user"` with attributes `{ role: "admin" }`
  - `"batch-worker"` with attributes `{ role: "editor" }`
- **oauth2Clients**: `"web-app"` with:
  - redirectURIs including the static website URL with `/callback` path
  - grantTypes: `["authorization_code", "refresh_token"]`
- **idProvider**: use the idp provider method with `"web-app"` and `"default-idp-client"`

### Generators

Define generators as a **named export** called `generators`:

- Include `@tailor-platform/kysely-type` with distPath `"./generated/db.ts"`

### Config (default export)

- name: `"challenge-008"`
- cors: use the static website URL reference
- db: `{ tailordb: { files: ["./tailordb/*.ts"] } }`
- idp, auth, staticWebsites: wire in the definitions above

## Requirements

- Import `user` from `./tailordb/user`
- The file must have a **default export** from `defineConfig()`
- The file must have a **named export** `generators` from `defineGenerators()`

## Reference

Refer to the installed SDK package for configuration patterns.
