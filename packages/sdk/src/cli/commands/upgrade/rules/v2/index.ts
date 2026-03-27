import { renameExecutorTriggersRule } from "./rename-executor-triggers";
import type { MigrationRule } from "../../types";

// Re-export rule helpers for use by individual rule files
export { createRule, type SourceRule } from "../../rule-helpers";

/**
 * All V2 migration rules.
 * Add new rules to this array as breaking changes are finalized.
 */
export const v2Rules: MigrationRule[] = [renameExecutorTriggersRule];
