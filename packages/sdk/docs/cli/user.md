# User & Auth Commands

Commands for authentication and user management.

## login

Login to Tailor Platform.

```bash
tailor-sdk login
```

## logout

Logout from Tailor Platform.

```bash
tailor-sdk logout
```

## user

Manage Tailor Platform users.

```bash
tailor-sdk user <subcommand> [options]
```

### user current

Show current user.

```bash
tailor-sdk user current [options]
```

### user list

List all users.

```bash
tailor-sdk user list [options]
```

**Options:**

- `--json` - Output as JSON

### user use

Set current user.

```bash
tailor-sdk user use <user>
```

**Arguments:**

- `user` - User email (required)

### user pat

Manage personal access tokens.

```bash
tailor-sdk user pat <subcommand> [options]
```

When no subcommand is provided, defaults to `list`.

#### user pat list

List all personal access tokens.

```bash
tailor-sdk user pat list [options]
```

**Options:**

- `--json` - Output as JSON

**Output (default):**

```
 token-name-1: read/write
 token-name-2: read
```

**Output (`--json`):**

```json
[
  { "name": "token-name-1", "scopes": ["read", "write"] },
  { "name": "token-name-2", "scopes": ["read"] }
]
```

#### user pat create

Create a new personal access token.

```bash
tailor-sdk user pat create <name> [options]
```

**Arguments:**

- `name` - Token name (required)

**Options:**

- `-w, --write` - Grant write permission (default: read-only)
- `--json` - Output as JSON

**Output (default):**

```
Personal access token created successfully.

  name: token-name
scopes: read/write
 token: tpp_xxxxxxxxxxxxx

Please save this token in a secure location. You won't be able to see it again.
```

**Output (`--json`):**

```json
{ "name": "token-name", "scopes": ["read", "write"], "token": "eyJhbGc..." }
```

#### user pat delete

Delete a personal access token.

```bash
tailor-sdk user pat delete <name>
```

**Arguments:**

- `name` - Token name (required)

#### user pat update

Update a personal access token (delete and recreate).

```bash
tailor-sdk user pat update <name> [options]
```

**Arguments:**

- `name` - Token name (required)

**Options:**

- `-w, --write` - Grant write permission (if not specified, keeps read-only)
- `--json` - Output as JSON

**Output (default):**

```
Personal access token updated successfully.

  name: token-name
scopes: read/write
 token: tpp_xxxxxxxxxxxxx

Please save this token in a secure location. You won't be able to see it again.
```

**Output (`--json`):**

```json
{
  "name": "token-name",
  "scopes": ["read", "write"],
  "token": "tpp_xxxxxxxxxxxxx"
}
```
