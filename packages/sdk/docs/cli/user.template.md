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
{{politty:command:auth}}
{{politty:command:user}}
When no subcommand is provided, defaults to `list`.

**Output (default):**

```
┌──────────────┬────────────┬──────────────┬──────────────┐
│ name         │ scopes     │ createdAt    │ lastUsedAt   │
├──────────────┼────────────┼──────────────┼──────────────┤
│ token-name-1 │ read/write │ 8 months ago │ 6 months ago │
│ token-name-2 │ read       │ 8 months ago │ never        │
└──────────────┴────────────┴──────────────┴──────────────┘
```

`lastUsedAt` reads `never` until the token has been used to authenticate, and is
updated at most once per hour.

**Output (`-j, --json`):**

```json
[
  {
    "name": "token-name-1",
    "scopes": ["read", "write"],
    "createdAt": "2026-01-02T03:04:05.000Z",
    "lastUsedAt": "2026-03-04T05:06:07.000Z"
  },
  {
    "name": "token-name-2",
    "scopes": ["read"],
    "createdAt": "2026-01-02T03:04:05.000Z",
    "lastUsedAt": null
  }
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
