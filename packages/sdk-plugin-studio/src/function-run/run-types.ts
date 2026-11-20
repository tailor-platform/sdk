export type RunEvent =
  | { type: "stdout" | "stderr"; line: string }
  | { type: "exit"; code: number | null };

export interface RunHandle {
  events: AsyncIterable<RunEvent>;
  stop: () => void;
}

export interface RunInput {
  file: string;
  argFile: string;
  workspaceArgs: string[];
}
