import { getNodeBuiltinMessage, isNodeBuiltinImport } from "#/utils/node-builtins";

/**
 * Check if a module specifier is a blocked Node.js built-in.
 * @param specifier - Module specifier to check (e.g. "node:crypto", "fs")
 * @returns Whether the specifier is blocked
 */
export function isBlockedModule(specifier: string): boolean {
  return isNodeBuiltinImport(specifier);
}

/**
 * Get the error message for a blocked module import.
 * @param specifier - Module specifier that was blocked
 * @returns Error message with optional suggestion for the Web Standard API alternative
 */
export function getBlockedMessage(specifier: string): string {
  return getNodeBuiltinMessage(specifier);
}
