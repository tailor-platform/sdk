# 021: Full Application Configuration

## Goal

Create a complete application configuration using `defineConfig`, `defineAuth`, `defineIdp`, and `defineStaticWebSite`.

## Instructions

A `User` model is already provided in `tailordb/user.ts` with the following fields:

| Field | Type   | Required | Notes                                       |
| ----- | ------ | -------- | ------------------------------------------- |
| email | string | yes      | Unique                                      |
| name  | string | yes      |                                             |
| role  | enum   | yes      | Allowed values: `admin`, `member`, `viewer` |

Create the file `tailor.config.ts` with a **default export** using `defineConfig`.

### Static Website

Define a static website:

- Name: `"my-frontend"`
- Description: `"Frontend application"`

### Identity Provider

Define an IdP:

- Name: `"my-idp"`
- Authorization: `"loggedIn"`
- Clients: `["default-idp-client"]`

### Auth

Define auth with name `"my-auth"`:

- **userProfile**:
  - type: reference to the `user` model
  - usernameField: `"email"`
  - attributes: `{ role: true }`
- **machineUsers**:
  - `"admin-machine-user"` with attributes: `{ role: "admin" }`
- **oauth2Clients**:
  - `"web-app"` with:
    - redirectURIs: `["http://localhost:3000/callback", "${website.url}/callback"]` (use the static website url reference)
    - grantTypes: `["authorization_code", "refresh_token"]`
- **idProvider**: use `idp.provider("web-app", "default-idp-client")`

### Config

- name: `"challenge-021"`
- cors: `[website.url]`
- db: `{ tailordb: { files: ["./tailordb/*.ts"] } }`
- idp: `[idp]`
- auth: the auth defined above
- staticWebsites: `[website]`

## Requirements

- Import `user` from `./tailordb/user`
- Import `defineConfig`, `defineAuth`, `defineIdp`, `defineStaticWebSite` from `@tailor-platform/sdk`
- The file must have a **default export** from `defineConfig()`

## Reference

Refer to the installed SDK package for configuration patterns.
