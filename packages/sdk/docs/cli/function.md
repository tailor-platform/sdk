# Function Commands

Commands for viewing function execution logs.

<!-- politty:command:function:heading:start -->

## function

<!-- politty:command:function:heading:end -->

<!-- politty:command:function:description:start -->

Manage functions

<!-- politty:command:function:description:end -->

<!-- politty:command:function:usage:start -->

**Usage**

```
tailor-sdk function [command]
```

<!-- politty:command:function:usage:end -->

<!-- politty:command:function:subcommands:start -->

**Commands**

| Command                           | Description                          |
| --------------------------------- | ------------------------------------ |
| [`function logs`](#function-logs) | List or get function execution logs. |

<!-- politty:command:function:subcommands:end -->
<!-- politty:command:function logs:heading:start -->

### function logs

<!-- politty:command:function logs:heading:end -->

<!-- politty:command:function logs:description:start -->

List or get function execution logs.

<!-- politty:command:function logs:description:end -->

<!-- politty:command:function logs:usage:start -->

**Usage**

```
tailor-sdk function logs [options] [executionId]
```

<!-- politty:command:function logs:usage:end -->

<!-- politty:command:function logs:arguments:start -->

**Arguments**

| Argument      | Description                                         | Required |
| ------------- | --------------------------------------------------- | -------- |
| `executionId` | Execution ID (if provided, shows details with logs) | No       |

<!-- politty:command:function logs:arguments:end -->

<!-- politty:command:function logs:options:start -->

**Options**

| Option                          | Alias | Description       | Required | Default |
| ------------------------------- | ----- | ----------------- | -------- | ------- |
| `--json`                        | `-j`  | Output as JSON    | No       | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       |

<!-- politty:command:function logs:options:end -->

**Usage Examples:**

```bash
# List all function execution logs
tailor-sdk function logs

# Get execution details with logs
tailor-sdk function logs <execution-id>

# Output as JSON
tailor-sdk function logs --json
tailor-sdk function logs <execution-id> --json
```
