export interface RunRecord {
  success?: boolean;
  scriptName?: string;
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

function failureText(value: unknown): string | undefined {
  const error = (value as { error?: { message?: unknown; suggestion?: unknown } } | undefined)
    ?.error;
  if (typeof error?.message !== "string") return undefined;
  return [error.message, error.suggestion]
    .filter((part) => typeof part === "string" && part)
    .join("\n");
}

export function parseFrame(frame: string): StreamMessage | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7);
    else if (line.startsWith("data: ")) data.push(line.slice(6));
  }
  const text = data.join("\n");

  if (event === "exit") return { type: "exit" };
  const parsed = parseJson(text);
  if (event === "stdout") {
    if (typeof parsed === "object" && parsed !== null) {
      return { type: "run", record: parsed as RunRecord };
    }
    return { type: "note", text };
  }
  if (event === "stderr") {
    const failure = failureText(parsed);
    return failure === undefined ? { type: "note", text } : { type: "failure", text: failure };
  }
  return undefined;
}
