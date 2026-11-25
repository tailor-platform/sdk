export interface RunRecord {
  success?: boolean;
  scriptName?: string;
  functionType?: string;
  functionName?: string;
  executionId?: string;
  logs?: string;
  result?: string;
  error?: string;
}

export type StreamMessage =
  | { type: "run"; record: RunRecord }
  | { type: "failure"; text: string }
  | { type: "note"; text: string }
  | { type: "exit" };

export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { frames: parts, rest };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const RUN_RECORD_TEXT_FIELDS = [
  "scriptName",
  "functionName",
  "functionType",
  "executionId",
  "logs",
  "result",
  "error",
] as const;

function isRunRecord(value: unknown): value is RunRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.success !== "boolean") return false;
  return RUN_RECORD_TEXT_FIELDS.every(
    (field) => record[field] === undefined || typeof record[field] === "string",
  );
}

function failureText(value: unknown): string | undefined {
  const error = (value as { error?: { message?: unknown; suggestion?: unknown } } | undefined)
    ?.error;
  if (typeof error?.message !== "string") return undefined;
  return [error.message, error.suggestion]
    .filter((part) => typeof part === "string" && part)
    .join("\n");
}

/**
 * Turn one output event of `tailor function run --json` into something to show.
 * @param event - `stdout`, `stderr` or `exit`
 * @param text - The line the event carries
 * @returns The message, or undefined for an event it does not know
 */
export function interpret(event: string, text: string): StreamMessage | undefined {
  if (event === "exit") return { type: "exit" };
  const parsed = parseJson(text);
  if (event === "stdout") {
    return isRunRecord(parsed) ? { type: "run", record: parsed } : { type: "note", text };
  }
  if (event === "stderr") {
    const failure = failureText(parsed);
    return failure === undefined ? { type: "note", text } : { type: "failure", text: failure };
  }
  return undefined;
}

/**
 * Read one server-sent event frame.
 * @param frame - Text of a frame, without the blank line that ends it
 * @returns The event name and its data
 */
export function parseEventFrame(frame: string): { event: string; data: string } {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data.push(line.slice(6));
  }
  return { event, data: data.join("\n") };
}
