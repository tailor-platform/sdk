## query

Run SQL/GraphQL query.

**Usage**

```
tailor query [options]
```

**Options**

| Option                          | Alias | Description                                                                                          | Required | Default              | Env                                 |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- | -------- | -------------------- | ----------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                                         | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`      |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                                    | No       | -                    | `TAILOR_PLATFORM_PROFILE`           |
| `--config <CONFIG>`             | `-c`  | Path to Tailor config file                                                                           | No       | `"tailor.config.ts"` | `TAILOR_CONFIG_PATH`                |
| `--engine <ENGINE>`             | -     | Query engine (sql or gql)                                                                            | Yes      | -                    | -                                   |
| `--query <QUERY>`               | `-q`  | Query string to execute directly; omit to start REPL mode                                            | No       | -                    | -                                   |
| `--file <FILE>`                 | `-f`  | Read query string from file; omit to start REPL mode                                                 | No       | -                    | -                                   |
| `--edit`                        | -     | Open a temporary file in your editor; omit to start REPL mode                                        | No       | `false`              | -                                   |
| `--machine-user <MACHINE_USER>` | `-m`  | Machine user name for query execution. Falls back to the active profile's default machine user.      | No       | -                    | `TAILOR_PLATFORM_MACHINE_USER_NAME` |
| `--newline-on-enter`            | -     | REPL: when true, Enter inserts a newline and Shift+Enter submits. Use --no-newline-on-enter to swap. | No       | -                    | -                                   |
| `--namespace <NAMESPACE>`       | `-n`  | TailorDB namespace to run SQL queries in (sql engine only)                                           | No       | -                    | -                                   |

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

**Examples**

**Run a SQL query**

```bash
$ tailor query --engine sql -q 'select * from "User";'
```

**Run a SQL query in a specific namespace**

```bash
$ tailor query --engine sql --namespace analytics -q 'select count(*) from "Event";'
```

**Notes**

With `--engine sql`, each query runs in a single TailorDB namespace. When the config defines one namespace, that namespace is used; when it defines several, it is inferred from the tables the query references. Pass `--namespace` to choose it yourself, for example when it cannot be inferred or a table name exists in more than one namespace. The namespace must be declared under `db` in the config; namespaces declared with `{ external: true }` are accepted. In REPL mode, `--namespace` applies to every query in the session.
