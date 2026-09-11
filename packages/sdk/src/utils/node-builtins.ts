import { NODE_ONLY_GLOBALS } from "#/utils/es-builtins";

export {
  getForbiddenGlobalMessage,
  getNodeBuiltinMessage,
  isNodeBuiltinImport,
} from "@tailor-platform/shared/node-builtins";

export function isForbiddenGlobal(name: string): boolean {
  return NODE_ONLY_GLOBALS.has(name);
}
