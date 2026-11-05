import * as path from "pathe";
import type { Application } from "#/cli/services/application";
import type { Resolver } from "#/types/resolver.generated";

/** A resolver of the project and the file defining it. */
export interface ResolverEntry {
  name: string;
  file: string;
  resolver: Resolver;
}

/**
 * List the resolvers of an application with the files defining them.
 * @param application - Application defined from the project's config
 * @returns Each loaded resolver, in config order
 */
export async function listResolvers(application: Application): Promise<ResolverEntry[]> {
  await Promise.all(application.resolverServices.map((service) => service.loadResolvers()));
  return application.resolverServices.flatMap((service) =>
    Object.entries(service.resolvers).map(([file, resolver]) => ({
      name: resolver.name,
      file,
      resolver,
    })),
  );
}

const PRELUDE = `import type { output } from "@tailor-platform/sdk";

type Expand<T> = { [K in keyof T]: T[K] } & {};

type FieldsOutput<F> = Expand<
  {
    [K in keyof F as null extends output<F[K]> ? never : K]: output<F[K]>;
  } & {
    [K in keyof F as null extends output<F[K]> ? K : never]?: output<F[K]>;
  }
>;

type Wire<T> = T extends { toJSON(): string }
  ? string
  : T extends readonly (infer E)[]
    ? Wire<E>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

type ResolverFunction<R extends { input?: unknown; output: unknown }> = [
  Exclude<R["input"], undefined>,
] extends [never]
  ? () => Promise<Wire<output<R["output"]>>>
  : (
      input: Wire<FieldsOutput<Exclude<R["input"], undefined>>>,
    ) => Promise<Wire<output<R["output"]>>>;
`;

/**
 * Render the declarations typing a call to each resolver, derived from the
 * resolver definition files so `input` and `output` are never restated.
 * @param entries - Resolvers of the project
 * @returns TypeScript source declaring one function per resolver
 */
export function renderResolverDeclarations(entries: readonly ResolverEntry[]): string {
  const declarations = entries.map(({ name, file }, index) => {
    const specifier = JSON.stringify(path.join(path.dirname(file), path.parse(file).name));
    return [
      `import type definition${index} from ${specifier};`,
      `declare const resolver${index}: ResolverFunction<typeof definition${index}>;`,
      `export { resolver${index} as ${JSON.stringify(name)} };`,
    ].join("\n");
  });
  return [PRELUDE, ...declarations, ""].join("\n");
}
