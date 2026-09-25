/**
 * Extract module specifiers from import / export-from / require / dynamic-import
 * statements, ignoring anything inside comments or string/template literals.
 */
export function extractImportSpecifiers(source: string): string[];
