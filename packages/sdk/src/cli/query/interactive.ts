import * as readline from "node:readline/promises";
import { parse as parseGraphQL } from "@0no-co/graphql.web";
import { logger } from "../shared/logger";
import type { QueryEngine } from "./index";

type InteractiveQueryHandler = (query: string) => Promise<void>;

type InteractiveSessionOptions = {
  engine: QueryEngine;
  onQuery: InteractiveQueryHandler;
};

function isCompleteGraphQL(text: string): boolean {
  try {
    parseGraphQL(text);
    return true;
  } catch {
    return false;
  }
}

function printHelp(engine: QueryEngine): void {
  logger.log("  \\h, \\help, \\?  Show this help");
  logger.log("  \\q, \\quit      Exit REPL");
  logger.log("  \\clear, \\c     Clear screen");
  logger.log("  Ctrl+C         Cancel current input");
  logger.log("  Ctrl+D         Exit REPL (when prompt is empty)");
  logger.log("");
  if (engine === "sql") {
    logger.log('  SQL: terminate statement with ";" to execute.');
  } else {
    logger.log("  GQL: query is auto-executed when valid GraphQL is detected.");
  }
}

function isReadyToExecute(engine: QueryEngine, buffer: string): boolean {
  if (engine === "sql") {
    return buffer.trimEnd().endsWith(";");
  }
  return isCompleteGraphQL(buffer);
}

/**
 *
 * @param options
 */
export async function startInteractiveSession(options: InteractiveSessionOptions): Promise<void> {
  const { engine, onQuery } = options;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  const prompt = `${engine}> `;
  const continuationPrompt = "  -> ";

  let buffer = "";

  const showPrompt = () => {
    rl.setPrompt(buffer ? continuationPrompt : prompt);
    rl.prompt();
  };

  const resetBuffer = () => {
    buffer = "";
    if (rl.line.length > 0) {
      rl.write(null, { ctrl: true, name: "u" });
    }
    logger.log("");
    showPrompt();
  };

  rl.on("SIGINT", () => {
    if (buffer || rl.line.length > 0) {
      resetBuffer();
    } else {
      rl.close();
    }
  });

  logger.info(`Interactive ${engine.toUpperCase()} mode. Type \\h for help, \\q to exit.`);

  showPrompt();

  for await (const line of rl) {
    const trimmed = line.trim();

    if (!buffer && trimmed.startsWith("\\")) {
      const cmd = trimmed.toLowerCase();
      if (cmd === "\\q" || cmd === "\\quit") {
        break;
      }
      if (cmd === "\\h" || cmd === "\\help" || cmd === "\\?") {
        printHelp(engine);
        showPrompt();
        continue;
      }
      if (cmd === "\\clear" || cmd === "\\c") {
        process.stderr.write("\x1b[2J\x1b[H");
        showPrompt();
        continue;
      }
      logger.warn(`Unknown command: ${trimmed}. Type \\h for help.`);
      showPrompt();
      continue;
    }

    if (trimmed === "" && !buffer) {
      showPrompt();
      continue;
    }

    buffer += (buffer ? "\n" : "") + line;

    if (!isReadyToExecute(engine, buffer)) {
      showPrompt();
      continue;
    }

    const queryText = buffer.trim();
    buffer = "";

    try {
      await onQuery(queryText);
    } catch (error) {
      logger.error(error instanceof Error ? error.message : String(error));
    }

    showPrompt();
  }

  rl.close();
  logger.info("Bye.");
}
