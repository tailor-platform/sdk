import type * as madgeTypes from "madge";

export type MadgeLoader = (
  path: madgeTypes.MadgePath,
  config?: madgeTypes.MadgeConfig,
) => Promise<madgeTypes.MadgeInstance>;
