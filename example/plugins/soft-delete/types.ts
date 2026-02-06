/**
 * Soft Delete Plugin Types
 *
 * Context types for executor factories.
 */

import type { TailorAnyDBType } from "@tailor-platform/sdk";

/**
 * Context for soft-delete executor factories.
 */
export interface SoftDeleteContext {
  /** Source type that the plugin is attached to */
  sourceType: TailorAnyDBType;
  /** Generated archive type */
  archiveType: TailorAnyDBType;
  /** TailorDB namespace */
  namespace: string;
  /** Index signature for PluginExecutorContext compatibility */
  [key: string]: TailorAnyDBType | string;
}
