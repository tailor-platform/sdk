import type { RecordTypeMeta } from "#/client/records";
import type { ResolverOperation } from "./operation";

/** Name of the file standing for the project's resolvers. */
export const RESOLVERS_FILE = "resolvers.tailor";

/** Name of the file standing for the project's TailorDB types. */
export const TAILORDB_FILE = "tailordb.tailor";

const IDENTIFIER_NAME = /^[A-Za-z_$][\w$]*$/;

function header(imported: string, url: string | undefined): string[] {
  return [
    `import { ${imported}, setResolverDefaults } from "@tailor-platform/sdk/client";`,
    ...(url === undefined ? [] : [`setResolverDefaults({ url: ${JSON.stringify(url)} });`]),
  ];
}

function exportedName(name: string): string {
  return IDENTIFIER_NAME.test(name) ? name : JSON.stringify(name);
}

/** What the module generated for `resolvers.tailor` is built from. */
export interface ResolverModuleInput {
  /** The operation of each resolver. */
  operations: readonly ResolverOperation[];
  /** Base URL the calls fall back to when the app does not configure one. */
  url?: string;
}

/**
 * Render the JavaScript module `resolvers.tailor` stands for at runtime: one
 * function per resolver, exported under the resolver's name.
 * @param input - The operations to call and the fallback URL
 * @returns JavaScript source
 */
export function renderResolverModule(input: ResolverModuleInput): string {
  const lines = header("callResolver", input.url);
  input.operations.forEach((operation, index) => {
    lines.push(
      `const resolver${index} = (variables) => callResolver(${JSON.stringify(operation)}, variables);`,
      `export { resolver${index} as ${exportedName(operation.field)} };`,
    );
  });
  return `${lines.join("\n")}\n`;
}

/** What the module generated for `tailordb.tailor` is built from. */
export interface TailorDBModuleInput {
  /** What each TailorDB type's operations are built from. */
  types: readonly { name: string; meta: RecordTypeMeta }[];
  /** Base URL the calls fall back to when the app does not configure one. */
  url?: string;
}

/**
 * Render the JavaScript module `tailordb.tailor` stands for at runtime: for each
 * TailorDB type, an object that gets, lists, creates, updates and deletes its
 * records, exported under the type's name.
 * @param input - What each type's operations are built from, and the fallback URL
 * @returns JavaScript source
 */
export function renderTailorDBModule(input: TailorDBModuleInput): string {
  const lines = header("createRecords", input.url);
  input.types.forEach(({ name, meta }, index) => {
    lines.push(
      `const crud${index} = createRecords(${JSON.stringify(meta)});`,
      `export { crud${index} as ${exportedName(name)} };`,
    );
  });
  return `${lines.join("\n")}\n`;
}
