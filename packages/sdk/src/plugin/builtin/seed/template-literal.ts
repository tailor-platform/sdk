/**
 * Escape generated script source before embedding it in a template literal.
 * @param scriptCode - Generated script source to embed.
 * @returns Escaped template literal content.
 */
export function escapeSeedScriptCodeForTemplateLiteral(scriptCode: string): string {
  return scriptCode.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
}
