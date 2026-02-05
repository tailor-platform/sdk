export { changeHistoryPlugin, getGeneratedType } from "./plugin";
export type {
  ChangeHistoryAction,
  ChangeHistoryRecord,
  GeneratedTypeKind,
  ParsedChangeHistory,
} from "./types";
export { parseChangeHistory } from "./types";

/**
 * Executor factories for change-history plugin.
 * Uses dynamic imports to enable tree-shaking when bundled with inlineDynamicImports.
 */
export const executors = {
  /** @returns Dynamic import of on-create executor */
  onCreate: () => import("./executors/on-create"),
  /** @returns Dynamic import of on-update executor */
  onUpdate: () => import("./executors/on-update"),
  /** @returns Dynamic import of on-delete executor */
  onDelete: () => import("./executors/on-delete"),
};
