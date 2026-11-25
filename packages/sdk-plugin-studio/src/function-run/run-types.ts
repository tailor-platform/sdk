import type { WorkspaceSelection } from "../workspace-context";
import type { RunRecord } from "./stream";

export type RunEvent =
  | { type: "ready" }
  | { type: "scheduled" }
  | { type: "queued" }
  | { type: "started" }
  | { type: "finished"; record: RunRecord }
  | { type: "failed"; text: string }
  | { type: "note"; text: string }
  | { type: "exit"; code: number | null };

export interface RunHandle {
  events: AsyncIterable<RunEvent>;
  stop: () => void;
}

export interface RunInput {
  file: string;
  argFile: string;
  workspace: WorkspaceSelection;
  env: NodeJS.ProcessEnv;
}
