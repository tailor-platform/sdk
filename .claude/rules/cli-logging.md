---
paths:
  - "packages/sdk/src/cli/**/*.ts"
---

# CLI Logging Guidelines

The CLI module uses a unified logging system. Always use `logger` and `styles` from `src/cli/utils/logger.ts`.

**Imports:**

```typescript
import { logger, styles } from "../utils/logger";
```

**Logger Methods:**

- `logger.info(message, opts?)` - Informational messages (output to stderr)
- `logger.success(message, opts?)` - Success messages (output to stderr)
- `logger.warn(message, opts?)` - Warning messages (output to stderr)
- `logger.error(message, opts?)` - Error messages (output to stderr)
- `logger.log(message)` - Raw output without prefix (output to stderr)
- `logger.debug(message)` - Debug messages in dim color (output to stderr)
- `logger.out(data)` - Primary output for stdout (string, object, or object[])

**LogMode Options:**

```typescript
type LogMode = "default" | "stream" | "plain";

logger.info("message", { mode: "default" }); // Symbol prefix, no timestamp (default)
logger.info("message", { mode: "stream" }); // Timestamp prefix (for watch/polling)
logger.info("message", { mode: "plain" }); // No prefix (for list items)
```

| Mode      | Symbol | Timestamp | Color | Use Case                           |
| --------- | ------ | --------- | ----- | ---------------------------------- |
| `default` | ✅     | ❌        | ✅    | Normal output (command results)    |
| `stream`  | ✅     | ✅        | ✅    | Log streams (watch mode, polling)  |
| `plain`   | ❌     | ❌        | ✅    | Subdued info (list items, details) |

Colors in plain mode are semantic (success=green, error=red, info=cyan, warn=yellow)
and provide important visual distinction without structural decoration (icons/timestamps).

**Styles for Text Formatting:**

```typescript
styles.success(text); // Green
styles.error(text); // Red
styles.warning(text); // Yellow
styles.info(text); // Cyan
styles.dim(text); // Gray
styles.bold(text); // Bold
```

**stdout vs stderr (following [clig.dev](https://clig.dev/#output) guidelines):**

| Stream   | Method                                     | Use Case                              |
| -------- | ------------------------------------------ | ------------------------------------- |
| `stdout` | `logger.out()`                             | Primary program output (data, tables) |
| `stderr` | `logger.info/success/warn/error/log/debug` | Logs, diagnostics, progress messages  |

This separation allows piping data to other commands without log messages interfering.

**Rules:**

1. ❌ Do NOT import `consola` directly - use `logger` instead
2. ❌ Do NOT create custom consola instances
3. ❌ Do NOT use `console.log()` or `process.stdout.write()` directly - use `logger.out()` for stdout
4. ✅ Use `logger` for all CLI output
5. ✅ Use `styles` for inline text coloring
6. ✅ Use `logger.out()` for structured data output (handles JSON mode automatically)
