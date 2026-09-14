# CLI Logging Guidelines

The CLI module uses a unified logging system. Always use `logger` and `styles` from `src/cli/shared/logger.ts`.

**Imports:**

```typescript
import { logger, styles } from "../shared/logger";
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

1. ❌ Do NOT use `console.log()` or `process.stdout.write()` directly - use `logger.out()` for stdout
2. ✅ Use `logger` for all CLI output
3. ✅ Use `styles` for inline text coloring
4. ✅ Use `logger.out()` for structured data output (handles JSON mode automatically)

## Output Placement: default vs `--verbose` vs `--json`

The method you call decides who sees a line. `logger.debug()` is gated on `logger.verbose` (see the
Verbose Output section of `packages/sdk/docs/cli-reference.md`); everything else is unconditional.

`--json` is an orthogonal format axis, not a fourth verbosity level. It may swap a human rendering
for its structured equivalent — a spinner, the deploy plan text, a formatted error — but it must
never drop information the caller still needs: move that into the JSON payload or onto stderr.

| Content                                                                  | Goes to                    |
| ------------------------------------------------------------------------ | -------------------------- |
| The outcome, and the counts or totals that let a caller verify it        | default (`info`/`success`) |
| A change set the user must review or approve                             | default                    |
| Anything the user must act on: warnings, remediation flags, failed items | default (`warn`/`error`)   |
| Per-item progress: each file loaded, type parsed, item skipped           | `logger.debug()`           |
| Resolved paths, timings, extracted configuration dumps                   | `logger.debug()`           |
| A live feed of remote events (`--follow`, polling)                       | `mode: "stream"`           |

**Decision rule:** per-item output belongs in default when the reader must **act on each item**,
regardless of how many lines that produces. A list of every loaded table is progress, so it is
verbose-only; a list of fields that need `--expand-contract`, or a per-resource deploy plan, is the
decision the command exists to support, so it stays in default output however long it runs.

Two things this does not cover. Inherently streaming commands (`function logs --follow`, workflow
waiters) emit an unbounded feed by design — the per-event lines are the product. And a stack trace
that came back from a _remote_ execution is result data the user asked for; only the CLI's own
internal traces are verbose-gated.

### Errors under `--json`

A failure is serialized by `errorToJson()` into `{ error: { … } }` on stderr. Every field except
`message` is optional, so a `throw new Error(...)` reaching the top level becomes
`UNEXPECTED_ERROR` with the whole explanation flattened into one prose string. Callers cannot
branch on that, so never leave a nameable condition to that path.

When you add or touch an error a caller could plausibly recover from, throw a `CLIError` and
split it across the envelope instead:

- `code` — a specific, stable identifier for the condition. `CLIError` falls back to `CLI_ERROR`
  when you omit it, which is only acceptable for a failure no caller would branch on.
- `message` — what failed, and nothing else. No remediation prose, no embedded newlines.
- `suggestion` — the remediation, as its own field.
- `next` — an executable recovery action (`{ command, args }`), so the caller can run it rather
  than parse for it.
- `command` — the owning command path, serialized as `error.help` pointing at its `--help`.
- `context` — the machine-usable facts behind the failure (resource names, per-phase causes),
  never secrets.

Diagnostics stay on stderr in JSON mode so that stdout holds only the parseable result.
