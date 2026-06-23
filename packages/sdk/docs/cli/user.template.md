---
politty:
  index:
    title: "User & Auth Commands"
    description: "Commands for authentication and user management."
---

# User & Auth Commands

Commands for authentication and user management.

{{politty:command:login}}
{{politty:command:logout}}
{{politty:command:user}}
{{politty:command:user current}}
{{politty:command:user list}}
{{politty:command:user switch}}
{{politty:command:user pat}}
{{politty:command:user pat list}}
{{politty:command:user pat create}}
{{politty:command:user pat delete}}
{{politty:command:user pat update}}
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
