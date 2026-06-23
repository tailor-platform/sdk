---
politty:
  index:
    title: "User & Auth Commands"
    description: "Commands for authentication and user management."
---

# User & Auth Commands

Commands for authentication and user management.

{{politty:command:login:heading}}

{{politty:command:login:description}}

{{politty:command:login:usage}}

{{politty:command:login:options}}

{{politty:command:login:global-options-link}}

{{politty:command:logout:heading}}

{{politty:command:logout:description}}

{{politty:command:logout:usage}}

{{politty:command:logout:global-options-link}}

{{politty:command:user:heading}}

{{politty:command:user:description}}

{{politty:command:user:usage}}

{{politty:command:user:subcommands}}

{{politty:command:user:global-options-link}}
{{politty:command:user current:heading}}

{{politty:command:user current:description}}

{{politty:command:user current:usage}}

{{politty:command:user current:global-options-link}}
{{politty:command:user list:heading}}

{{politty:command:user list:description}}

{{politty:command:user list:usage}}

{{politty:command:user list:options}}

{{politty:command:user list:global-options-link}}
{{politty:command:user switch:heading}}

{{politty:command:user switch:description}}

{{politty:command:user switch:usage}}

{{politty:command:user switch:arguments}}

{{politty:command:user switch:global-options-link}}
{{politty:command:user pat:heading}}

{{politty:command:user pat:description}}

{{politty:command:user pat:usage}}

{{politty:command:user pat:options}}

{{politty:command:user pat:subcommands}}

{{politty:command:user pat:global-options-link}}
{{politty:command:user pat list:heading}}

{{politty:command:user pat list:description}}

{{politty:command:user pat list:usage}}

{{politty:command:user pat list:options}}

{{politty:command:user pat list:global-options-link}}
{{politty:command:user pat create:heading}}

{{politty:command:user pat create:description}}

{{politty:command:user pat create:usage}}

{{politty:command:user pat create:arguments}}

{{politty:command:user pat create:options}}

{{politty:command:user pat create:global-options-link}}
{{politty:command:user pat delete:heading}}

{{politty:command:user pat delete:description}}

{{politty:command:user pat delete:usage}}

{{politty:command:user pat delete:arguments}}

{{politty:command:user pat delete:global-options-link}}
{{politty:command:user pat update:heading}}

{{politty:command:user pat update:description}}

{{politty:command:user pat update:usage}}

{{politty:command:user pat update:arguments}}

{{politty:command:user pat update:options}}

{{politty:command:user pat update:global-options-link}}

When no subcommand is provided, defaults to `list`.

**Output (default):**

```
 token-name-1: read/write
 token-name-2: read
```

**Output (`-j, --json`):**

```json
[
  { "name": "token-name-1", "scopes": ["read", "write"] },
  { "name": "token-name-2", "scopes": ["read"] }
]
```

**Output (default):**

```
Personal access token created successfully.

  name: token-name
scopes: read/write
 token: tpp_xxxxxxxxxxxxx

Please save this token in a secure location. You won't be able to see it again.
```

**Output (`-j, --json`):**

```json
{ "name": "token-name", "scopes": ["read", "write"], "token": "eyJhbGc..." }
```

**Output (default):**

```
Personal access token updated successfully.

  name: token-name
scopes: read/write
 token: tpp_xxxxxxxxxxxxx

Please save this token in a secure location. You won't be able to see it again.
```

**Output (`-j, --json`):**

```json
{
  "name": "token-name",
  "scopes": ["read", "write"],
  "token": "tpp_xxxxxxxxxxxxx"
}
```
