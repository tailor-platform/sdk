# CLI Command Reference

## Global options

| Flag                   | Description                             |
| ---------------------- | --------------------------------------- |
| `--env-file, -e`       | Load environment variables (repeatable) |
| `--env-file-if-exists` | Load env file if it exists              |
| `--verbose`            | Verbose logging                         |
| `--json, -j`           | JSON output                             |

## Common options

| Flag                 | Description                                  |
| -------------------- | -------------------------------------------- |
| `--workspace-id, -w` | Target workspace ID                          |
| `--profile, -p`      | Workspace profile                            |
| `--config, -c`       | Config file path (default: tailor.config.ts) |
| `--yes, -y`          | Skip confirmations                           |

## Application commands

| Command                                 | Description                  |
| --------------------------------------- | ---------------------------- |
| `init [name]`                           | Initialize new project       |
| `generate [--watch]`                    | Generate files from config   |
| `apply [--dry-run] [--no-schema-check]` | Deploy to workspace          |
| `remove`                                | Remove all resources         |
| `show`                                  | Show deployed app info       |
| `open`                                  | Open Tailor Platform Console |

## TailorDB commands

| Command                                           | Description                         |
| ------------------------------------------------- | ----------------------------------- |
| `tailordb truncate [types]`                       | Delete all records from tables      |
| `tailordb migration generate [--name N] [--init]` | Generate migration from schema diff |
| `tailordb migration set <number>`                 | Set migration checkpoint            |
| `tailordb migration status`                       | Show migration status               |
| `tailordb erd export\|serve\|deploy`              | Entity relationship diagrams (beta) |

## Workflow commands

| Command                                                       | Description             |
| ------------------------------------------------------------- | ----------------------- |
| `workflow list`                                               | List workflows          |
| `workflow get <name>`                                         | Get workflow details    |
| `workflow start <name> -m <user> [-a JSON] [--wait] [--logs]` | Start execution         |
| `workflow executions [id] [-n name] [-s status] [--wait]`     | List/get executions     |
| `workflow resume <id> [--wait] [--logs]`                      | Resume failed execution |

## Executor commands

| Command                                                   | Description                              |
| --------------------------------------------------------- | ---------------------------------------- |
| `executor list`                                           | List executors                           |
| `executor get <name>`                                     | Get executor details                     |
| `executor jobs <name> [id] [-s status] [--wait] [--logs]` | List/get jobs                            |
| `executor trigger <name> [-d JSON] [-H headers] [--wait]` | Trigger manually (webhook/schedule only) |
| `executor webhook list`                                   | List webhook executors                   |

## Function commands

| Command                                                 | Description             |
| ------------------------------------------------------- | ----------------------- |
| `function test-run <file> [-n job] [-a JSON] [-m user]` | Run without deploying   |
| `function logs [id]`                                    | List/get execution logs |

## Auth commands

| Command                                 | Description                   |
| --------------------------------------- | ----------------------------- |
| `login` / `logout`                      | Manage authentication         |
| `user current\|list\|switch`            | Manage user accounts          |
| `user pat create\|list\|delete\|update` | Personal access tokens        |
| `machineuser list`                      | List machine users            |
| `machineuser token <name>`              | Get machine user access token |
| `oauth2client list\|get <name>`         | Manage OAuth2 clients         |

## Workspace commands

| Command                                        | Description               |
| ---------------------------------------------- | ------------------------- |
| `workspace create\|list\|delete\|get\|restore` | Manage workspaces         |
| `workspace app health\|list`                   | Check application health  |
| `workspace user invite\|list\|remove\|update`  | Manage workspace users    |
| `profile create\|list\|update\|delete`         | Manage workspace profiles |

## Secret commands

| Command                                                       | Description    |
| ------------------------------------------------------------- | -------------- |
| `secret vault create\|delete\|list`                           | Manage vaults  |
| `secret create\|update\|list\|delete --vault-name X --name Y` | Manage secrets |

## Static website commands

| Command                               | Description                 |
| ------------------------------------- | --------------------------- |
| `staticwebsite deploy -n name -d dir` | Deploy from local directory |
| `staticwebsite list\|get <name>`      | List/get website details    |

## Environment variables

| Variable                          | Description                  |
| --------------------------------- | ---------------------------- |
| `TAILOR_PLATFORM_WORKSPACE_ID`    | Default workspace ID         |
| `TAILOR_PLATFORM_TOKEN`           | Auth token                   |
| `TAILOR_PLATFORM_PROFILE`         | Default profile              |
| `TAILOR_PLATFORM_SDK_CONFIG_PATH` | Config file path             |
| `VISUAL` / `EDITOR`               | Editor for migration scripts |
