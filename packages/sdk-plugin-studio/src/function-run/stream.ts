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

export type SessionMessage =
  | { type: "run"; record: RunRecord }
  | { type: "failure"; text: string }
  | { type: "note"; text: string };

export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  return { frames: parts, rest };
}

/**
 * Say what failed in an error envelope, with its suggestion on the next line.
 * @param envelope - The error object `tailor --json` writes: `{ error: { message, suggestion? } }`
 * @returns The text to show, or the envelope as JSON when it carries no message
 */
export function describeFailure(envelope: unknown): string {
  const error = (envelope as { error?: { message?: unknown; suggestion?: unknown } } | undefined)
    ?.error;
  if (typeof error?.message !== "string") return JSON.stringify(envelope);
  return [error.message, error.suggestion]
    .filter((part) => typeof part === "string" && part)
    .join("\n");
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
