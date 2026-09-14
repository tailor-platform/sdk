---
paths:
  - "packages/sdk/src/cli/**/*.ts"
---

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

`--json` is an orthogonal format axis, not a fourth verbosity level. It swaps a human rendering for
its structured equivalent — the deploy plan text, a formatted error. Aim to keep the two paths
informationally equal: when you add something to the human path, give it a JSON counterpart rather
than leaving the machine caller worse off. Some paths do not meet that bar yet (a real deploy's
`--json` reports only a summary, and `function logs --json` omits the sourcemapped stack), so treat
it as the target for new work, not as a description of today's output.

Decide the stream first: if the line is the command's primary result, it is `logger.out()` on
stdout and none of the rows below apply. They cover stderr diagnostics only. "Default" below means
"not verbose-gated", not "call `info()`".

| Content                                                                  | Goes to                     |
| ------------------------------------------------------------------------ | --------------------------- |
| The command's primary result data                                        | `logger.out()` (stdout)     |
| The outcome, and the counts or totals that let a caller verify it        | default (`info`/`success`)  |
| A change set the user must review or approve                             | default                     |
| Anything the user must act on: warnings, remediation flags, failed items | default (`warn`/`error`)    |
| Indented detail lines under a preceding heading                          | `logger.log()` (plain mode) |
| Stability notices: beta, deprecation, upcoming removal                   | default (`warn`), once      |
| Per-item progress: each file loaded, type parsed, item skipped           | `logger.debug()`            |
| Resolved paths, timings, extracted configuration dumps                   | `logger.debug()`            |
| Status transitions while polling or following                            | `mode: "stream"`            |

**Decision rule:** keep per-item output in default only when omitting that specific item would
change what the user does next. A line the user cannot act on is progress even when it is a
`warn` — an unblocking validator failure stays a warning because the deploy continues, while a
list of fields needing `--expand-contract`, or a per-resource deploy plan, is the decision the
command exists to support and stays in default output however long it runs.

Three things this does not cover. Inherently streaming commands (`function logs --follow`,
workflow waiters) emit an unbounded feed by design — the per-event lines are the product, carried
by `logger.log()` because they already have their own remote timestamps; reserve `mode: "stream"`
for the surrounding status changes. A stack trace that came back from a _remote_ execution is
result data the user asked for; only the CLI's own internal traces are verbose-gated. And spinners
and progress meters are TTY affordances rather than a level: they self-disable off a TTY, so never
let one carry information that is not also emitted as a line.

Interactive prompts are not an output level either. `canPrompt()` is false under `--json`, in CI,
and on non-TTY stdin, so every prompt needs a non-interactive path (an explicit option or `--yes`)
rather than relying on the prompt being reached.

### Errors under `--json`

A failure is serialized into `{ error: { … } }` on stderr. Every field except `message` is
optional, so a `throw new Error(...)` reaching the top level becomes `UNEXPECTED_ERROR` with the
whole explanation flattened into one prose string. Callers cannot branch on that, so never leave a
nameable condition to that path.

There are two ways to give a failure structure. Throw a `CLIError` when you are raising it
yourself; wrap an error you did not construct — a `ConnectError`, an `AggregateError` — with
`withErrorDiagnostics()`, whose fields override the defaults. Either way, split the failure across
these fields instead of one prose blob:

- `code` — a specific, stable identifier for the condition. `CLIError` falls back to `CLI_ERROR`
  when you omit it, which is only acceptable for a failure no caller would branch on.
- `message` — what failed, and nothing else; keep remediation out of it. Multiple independent
  failures may span lines, but do not use it for anything the fields below own.
- `suggestion` — the remediation, as its own field.
- `details` — supplementary prose that does not belong in `message`.
- `next` — an executable recovery action (`{ command, args }`), so the caller can run it rather
  than parse for it.
- `command` — the owning command path, serialized as an `error.help` action targeting its `--help`.
- `context` — the machine-usable facts behind the failure (resource names, per-phase causes),
  never secrets.
