# 034: Auth Standalone Configuration

## Goal

Create a complete application configuration focused on auth and IdP setup using `defineConfig`, `defineAuth`, and `defineIdp`.

## Instructions

A `User` model is already provided in `tailordb/user.ts` with the following fields:

| Field | Type   | Required | Notes                                       |
| ----- | ------ | -------- | ------------------------------------------- |
| email | string | yes      | Unique                                      |
| name  | string | yes      |                                             |
| role  | enum   | yes      | Allowed values: `admin`, `editor`, `viewer` |

The model also includes automatic timestamp fields (`createdAt`, `updatedAt`).

Create the file `tailor.config.ts` with a **default export** using `defineConfig`.

### Identity Provider

Define an IdP:

- Name: `"app-idp"`
- Authorization: `"loggedIn"`
- Clients: `["default-idp-client"]`

### Auth

Define auth with name `"app-auth"`:

- **userProfile**:
  - type: reference to the `user` model
  - usernameField: `"email"`
  - attributes: `{ role: true }`
- **machineUsers**:
  - `"system-admin"` with attributes: `{ role: "admin" }`
  - `"batch-worker"` with attributes: `{ role: "editor" }`
- **oauth2Clients**:
  - `"web-client"` with:
    - redirectURIs: `["http://localhost:3000/callback"]`
    - grantTypes: `["authorization_code", "refresh_token"]`
- **idProvider**: use `idp.provider("web-client", "default-idp-client")`

### Config

- name: `"challenge-034"`
- db: `{ tailordb: { files: ["./tailordb/*.ts"] } }`
- idp: `[idp]`
- auth: the auth defined above

## Requirements

- Import `user` from `./tailordb/user`
- Import `defineConfig`, `defineAuth`, `defineIdp` from `@tailor-platform/sdk`
- The file must have a **default export** from `defineConfig()`

## Reference

Refer to the installed SDK package for configuration patterns.
