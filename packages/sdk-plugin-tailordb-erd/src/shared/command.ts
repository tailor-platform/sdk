import { createDefineCommand } from "politty";
import type { CommonArgsType } from "./args";

/**
 * defineCommand with global args type (CommonArgsType).
 * Use this for leaf commands with `run` to get type-safe access to global args.
 * Parent commands with only `subCommands` can use `defineCommand` from politty directly.
 */
export const defineAppCommand = createDefineCommand<CommonArgsType>();
