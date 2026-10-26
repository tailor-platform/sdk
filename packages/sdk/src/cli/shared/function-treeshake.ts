import type { TreeshakeOptions } from "#/configure/config/types";
import type { CommentsOptions, TreeshakingOptions } from "rolldown";

const BASE_FUNCTION_TREESHAKE_OPTIONS = {
  moduleSideEffects: false,
  annotations: true,
  unknownGlobalSideEffects: false,
} as const satisfies TreeshakingOptions;

// Takes effect only on minified output.
export const FUNCTION_BUNDLE_COMMENT_OPTIONS = {
  annotation: false,
} as const satisfies CommentsOptions;

export function mergeFunctionTreeshakeOptions(
  fragments: readonly TreeshakingOptions[],
): TreeshakingOptions {
  const merged: TreeshakingOptions = {};
  const manualPureFunctions = new Set<string>();

  for (const fragment of fragments) {
    Object.assign(merged, fragment);
    for (const name of fragment.manualPureFunctions ?? []) {
      manualPureFunctions.add(name);
    }
  }

  if (manualPureFunctions.size > 0) {
    merged.manualPureFunctions = [...manualPureFunctions];
  } else {
    delete merged.manualPureFunctions;
  }

  return merged;
}

export function composeFunctionTreeshakeOptions(
  fragments: readonly TreeshakingOptions[] = [],
): TreeshakingOptions {
  return mergeFunctionTreeshakeOptions([BASE_FUNCTION_TREESHAKE_OPTIONS, ...fragments]);
}

export function createUserTreeshakeOptions(options: TreeshakeOptions = {}): TreeshakingOptions {
  const { moduleSideEffects, annotations, unknownGlobalSideEffects, propertyReadSideEffects } =
    options;
  return {
    ...(moduleSideEffects !== undefined && { moduleSideEffects }),
    ...(annotations !== undefined && { annotations }),
    ...(unknownGlobalSideEffects !== undefined && { unknownGlobalSideEffects }),
    ...(propertyReadSideEffects !== undefined && {
      propertyReadSideEffects: propertyReadSideEffects ? "always" : false,
    }),
  };
}
