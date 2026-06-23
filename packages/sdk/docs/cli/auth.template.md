---
politty:
  index:
    title: "Auth Resource Commands"
    description: "Commands for managing Auth service resources."
---

# Auth Resource Commands

Commands for managing Auth service resources (auth connections, machine users, and OAuth2 clients).

{{politty:command:authconnection}}
{{politty:command:authconnection authorize}}
{{politty:command:authconnection delete}}
{{politty:command:authconnection list}}
{{politty:command:authconnection open}}
{{politty:command:authconnection revoke}}
{{politty:command:machineuser}}
{{politty:command:machineuser list}}
{{politty:command:machineuser token}}
{{politty:command:oauth2client}}
{{politty:command:oauth2client list}}
{{politty:command:oauth2client get}}
**Output:**

Returns a list of OAuth2 clients with the following fields:

- `name` - Client name
- `description` - Client description
- `clientId` - OAuth2 client ID
- `grantTypes` - Supported grant types (e.g., `authorization_code`, `refresh_token`)
- `redirectUris` - Registered redirect URIs
- `createdAt` - Creation timestamp

**Output:**

Returns the OAuth2 client credentials with the following fields:

- `name` - Client name
- `description` - Client description
- `clientId` - OAuth2 client ID
- `clientSecret` - OAuth2 client secret
- `grantTypes` - Supported grant types
- `redirectUris` - Registered redirect URIs
- `createdAt` - Creation timestamp
