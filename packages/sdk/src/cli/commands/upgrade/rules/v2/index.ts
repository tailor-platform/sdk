import { authInvokerRenameRule } from "./auth-invoker-rename";
import { defineGeneratorsRule } from "./define-generators";
import { publishEventsRenameRule } from "./publish-events-rename";
import type { MigrationRule } from "../../types";

/**
 * All V2 migration rules.
 * Add new rules to this array as breaking changes are finalized.
 */
export const v2Rules: MigrationRule[] = [
  defineGeneratorsRule,
  publishEventsRenameRule,
  authInvokerRenameRule,
];
