# Setup Commands

Commands for setting up project infrastructure.

<!-- politty:command:setup:heading:start -->

## setup

<!-- politty:command:setup:heading:end -->

<!-- politty:command:setup:description:start -->

Set up project infrastructure.

<!-- politty:command:setup:description:end -->

<!-- politty:command:setup:usage:start -->

**Usage**

```
tailor-sdk setup [command]
```

<!-- politty:command:setup:usage:end -->

<!-- politty:command:setup:subcommands:start -->

**Commands**

| Command                         | Description                                      |
| ------------------------------- | ------------------------------------------------ |
| [`setup github`](#setup-github) | Generate GitHub Actions workflow for deployment. |

<!-- politty:command:setup:subcommands:end -->
<!-- politty:command:setup github:heading:start -->

### setup github

<!-- politty:command:setup github:heading:end -->

<!-- politty:command:setup github:description:start -->

Generate GitHub Actions workflow for deployment.

<!-- politty:command:setup github:description:end -->

<!-- politty:command:setup github:usage:start -->

**Usage**

```
tailor-sdk setup github [options]
```

<!-- politty:command:setup github:usage:end -->

<!-- politty:command:setup github:options:start -->

**Options**

| Option                                  | Alias | Description                         | Required | Default |
| --------------------------------------- | ----- | ----------------------------------- | -------- | ------- |
| `--workspace-name <WORKSPACE_NAME>`     | `-n`  | Workspace name                      | Yes      | -       |
| `--workspace-region <WORKSPACE_REGION>` | `-r`  | Workspace region                    | Yes      | -       |
| `--organization-id <ORGANIZATION_ID>`   | `-o`  | Organization ID                     | Yes      | -       |
| `--folder-id <FOLDER_ID>`               | `-f`  | Folder ID                           | Yes      | -       |
| `--dir <DIR>`                           | `-d`  | App directory (for monorepo setups) | No       | `"."`   |

<!-- politty:command:setup github:options:end -->
