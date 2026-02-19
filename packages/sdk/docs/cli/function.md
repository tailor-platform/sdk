# Function Commands

Commands for viewing function execution logs.

<!-- politty:command:function:start -->

## function

Manage functions

**Usage**

```
tailor-sdk function [command]
```

**Commands**

| Command                           | Description                          |
| --------------------------------- | ------------------------------------ |
| [`function logs`](#function-logs) | List or get function execution logs. |

<!-- politty:command:function:end -->
<!-- politty:command:function logs:start -->

### function logs

List or get function execution logs.

**Usage**

```
tailor-sdk function logs [options] [executionId]
```

**Arguments**

| Argument      | Description                                         | Required |
| ------------- | --------------------------------------------------- | -------- |
| `executionId` | Execution ID (if provided, shows details with logs) | No       |

**Options**

| Option                          | Alias | Description       | Required | Default |
| ------------------------------- | ----- | ----------------- | -------- | ------- |
| `--json`                        | `-j`  | Output as JSON    | No       | `false` |
| `--workspace-id <WORKSPACE_ID>` | `-w`  | Workspace ID      | No       | -       |
| `--profile <PROFILE>`           | `-p`  | Workspace profile | No       | -       |

<!-- politty:command:function logs:end -->

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
