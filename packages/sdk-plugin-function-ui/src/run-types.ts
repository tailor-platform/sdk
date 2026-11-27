import type { RunRecord } from "./stream";
import type { WorkspaceSelection } from "@tailor-platform/shared/workspace-selection";

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
  /** Settles once nothing of the watch is running any more, which is after a stop has taken effect. */
  exited: Promise<void>;
}

export interface RunInput {
  file: string;
  argFile: string;
  workspace: WorkspaceSelection;
  env: NodeJS.ProcessEnv;
}
