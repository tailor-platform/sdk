---
politty:
  index:
    title: "Auth Resource Commands"
    description: "Commands for managing Auth service resources."
---

# Auth Resource Commands

Commands for managing Auth service resources (auth connections, machine users, and OAuth2 clients).

{{politty:command:authconnection:heading}}

{{politty:command:authconnection:description}}

{{politty:command:authconnection:usage}}

{{politty:command:authconnection:subcommands}}

{{politty:command:authconnection:global-options-link}}
{{politty:command:authconnection authorize:heading}}

{{politty:command:authconnection authorize:description}}

{{politty:command:authconnection authorize:usage}}

{{politty:command:authconnection authorize:options}}

{{politty:command:authconnection authorize:global-options-link}}
{{politty:command:authconnection delete:heading}}

{{politty:command:authconnection delete:description}}

{{politty:command:authconnection delete:usage}}

{{politty:command:authconnection delete:options}}

{{politty:command:authconnection delete:global-options-link}}

{{politty:command:authconnection list:heading}}

{{politty:command:authconnection list:description}}

{{politty:command:authconnection list:usage}}

{{politty:command:authconnection list:options}}

{{politty:command:authconnection list:global-options-link}}
{{politty:command:authconnection open:heading}}

{{politty:command:authconnection open:description}}

{{politty:command:authconnection open:usage}}

{{politty:command:authconnection open:options}}

{{politty:command:authconnection open:global-options-link}}

{{politty:command:authconnection revoke:heading}}

{{politty:command:authconnection revoke:description}}

{{politty:command:authconnection revoke:usage}}

{{politty:command:authconnection revoke:options}}

{{politty:command:authconnection revoke:global-options-link}}

{{politty:command:authconnection revoke:notes}}

{{politty:command:machineuser:heading}}

{{politty:command:machineuser:description}}

{{politty:command:machineuser:usage}}

{{politty:command:machineuser:subcommands}}

{{politty:command:machineuser:global-options-link}}
{{politty:command:machineuser list:heading}}

{{politty:command:machineuser list:description}}

{{politty:command:machineuser list:usage}}

{{politty:command:machineuser list:options}}

{{politty:command:machineuser list:global-options-link}}
{{politty:command:machineuser token:heading}}

{{politty:command:machineuser token:description}}

{{politty:command:machineuser token:usage}}

{{politty:command:machineuser token:arguments}}

{{politty:command:machineuser token:options}}

{{politty:command:machineuser token:global-options-link}}
{{politty:command:oauth2client:heading}}

{{politty:command:oauth2client:description}}

{{politty:command:oauth2client:usage}}

{{politty:command:oauth2client:subcommands}}

{{politty:command:oauth2client:global-options-link}}
{{politty:command:oauth2client list:heading}}

{{politty:command:oauth2client list:description}}

{{politty:command:oauth2client list:usage}}

{{politty:command:oauth2client list:options}}

{{politty:command:oauth2client list:global-options-link}}
{{politty:command:oauth2client get:heading}}

{{politty:command:oauth2client get:description}}

{{politty:command:oauth2client get:usage}}

{{politty:command:oauth2client get:arguments}}

{{politty:command:oauth2client get:options}}

{{politty:command:oauth2client get:global-options-link}}

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
