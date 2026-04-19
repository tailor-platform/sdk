<!-- politty:command:query:heading:start -->

## query

<!-- politty:command:query:heading:end -->

<!-- politty:command:query:description:start -->

Run SQL/GraphQL query.

<!-- politty:command:query:description:end -->

<!-- politty:command:query:usage:start -->

**Usage**

```
tailor-sdk query [options]
```

<!-- politty:command:query:usage:end -->

<!-- politty:command:query:options:start -->

**Options**

| Option                          | Alias | Description                                                                                          | Required | Default              | Env                                 |
| ------------------------------- | ----- | ---------------------------------------------------------------------------------------------------- | -------- | -------------------- | ----------------------------------- |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID                                                                                         | No       | -                    | `TAILOR_PLATFORM_WORKSPACE_ID`      |
| `--profile <PROFILE>`           | `-p`  | Workspace profile                                                                                    | No       | -                    | `TAILOR_PLATFORM_PROFILE`           |
| `--config <CONFIG>`             | `-c`  | Path to SDK config file                                                                              | No       | `"tailor.config.ts"` | `TAILOR_PLATFORM_SDK_CONFIG_PATH`   |
| `--engine <ENGINE>`             | -     | Query engine (sql or gql)                                                                            | Yes      | -                    | -                                   |
| `--query <QUERY>`               | `-q`  | Query string to execute directly; omit to start REPL mode                                            | No       | -                    | -                                   |
| `--file <FILE>`                 | `-f`  | Read query string from file; omit to start REPL mode                                                 | No       | -                    | -                                   |
| `--edit`                        | -     | Open a temporary file in your editor; omit to start REPL mode                                        | No       | `false`              | -                                   |
| `--machine-user <MACHINE_USER>` | `-m`  | Machine user name for query execution                                                                | Yes      | -                    | `TAILOR_PLATFORM_MACHINE_USER_NAME` |
| `--newline-on-enter`            | -     | REPL: when true, Enter inserts a newline and Shift+Enter submits. Use --no-newline-on-enter to swap. | No       | -                    | -                                   |

<!-- politty:command:query:options:end -->

<!-- politty:command:query:global-options-link:start -->

See [Global Options](../cli-reference.md#global-options) for options available to all commands.

<!-- politty:command:query:global-options-link:end -->
