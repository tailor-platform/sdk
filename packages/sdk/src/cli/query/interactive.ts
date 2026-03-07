import * as readline from "node:readline/promises";
import { logger } from "../shared/logger";

type InteractiveQueryHandler = (query: string) => Promise<void>;

function areBracesBalanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
  }
  return depth <= 0 && text.trim().length > 0;
}

interface InteractiveSessionOptions {
  engine: "sql" | "gql";
  onQuery: InteractiveQueryHandler;
}

/**
 * Start an interactive query session (psql-like REPL).
 *
 * - SQL mode: statements are terminated by `;`. Multi-line input is supported.
 * - GQL mode: auto-sends when `{` and `}` are balanced. Multi-line input is supported.
 * - Special commands: \q or exit to quit, \clear to clear screen.
 * @param options - Interactive session options
 */
export async function startInteractiveSession(options: InteractiveSessionOptions): Promise<void> {
  const { engine, onQuery } = options;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  const prompt = engine === "sql" ? "sql> " : "gql> ";
  const continuationPrompt = engine === "sql" ? "  -> " : "  -> ";

  logger.info(`Interactive ${engine.toUpperCase()} mode. Type \\q to exit.`);

  let buffer = "";

  const showPrompt = () => {
    rl.setPrompt(buffer ? continuationPrompt : prompt);
    rl.prompt();
  };

  showPrompt();

  for await (const line of rl) {
    const trimmed = line.trim();

    // Handle special commands (only when buffer is empty)
    if (!buffer && trimmed.startsWith("\\")) {
      const cmd = trimmed.toLowerCase();
      if (cmd === "\\q" || cmd === "\\quit") {
        break;
      }
      if (cmd === "\\clear") {
        process.stderr.write("\x1b[2J\x1b[H");
        showPrompt();
        continue;
      }
      logger.warn(`Unknown command: ${trimmed}`);
      showPrompt();
      continue;
    }

    if (!buffer && (trimmed === "exit" || trimmed === "quit")) {
      break;
    }

    if (engine === "sql") {
      buffer += (buffer ? "\n" : "") + line;

      if (!trimmed.endsWith(";")) {
        showPrompt();
        continue;
      }

      const queryText = buffer.trim();
      buffer = "";

      if (!queryText) {
        showPrompt();
        continue;
      }

      try {
        await onQuery(queryText);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
      }
    } else {
      // GQL mode: auto-send when braces are balanced
      if (trimmed === "" && !buffer) {
        showPrompt();
        continue;
      }

      buffer += (buffer ? "\n" : "") + line;

      if (!areBracesBalanced(buffer)) {
        showPrompt();
        continue;
      }

      const queryText = buffer.trim();
      buffer = "";

      if (!queryText) {
        showPrompt();
        continue;
      }

      try {
        await onQuery(queryText);
      } catch (error) {
        logger.error(error instanceof Error ? error.message : String(error));
      }
    }

    showPrompt();
  }

  rl.close();
  logger.info("Bye.");
}
