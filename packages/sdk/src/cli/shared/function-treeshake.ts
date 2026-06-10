import type { TreeshakingOptions } from "rolldown";

const BASE_FUNCTION_TREESHAKE_OPTIONS = {
  moduleSideEffects: false,
  annotations: true,
  unknownGlobalSideEffects: false,
} as const satisfies TreeshakingOptions;

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
