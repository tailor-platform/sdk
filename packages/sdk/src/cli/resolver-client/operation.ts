import { buildResolverSignature } from "#/cli/commands/deploy/resolver";
import type { Resolver } from "#/types/resolver.generated";

interface SignatureField {
  name: string;
  array?: boolean;
  required?: boolean;
  type?: { name?: string; required?: boolean; fields?: SignatureField[] };
}

/** The GraphQL operation that calls a resolver. */
export interface ResolverOperation {
  /** Root field the resolver is exposed as; the key of its value in the response `data`. */
  field: string;
  /** GraphQL document taking one variable per `input` key. */
  document: string;
}

function typeReference(field: SignatureField): string {
  const typeRequired = field.type?.required === true;
  const inner = `${field.type?.name}${typeRequired ? "!" : ""}`;
  const list = field.array ? `[${inner}]` : inner;
  return field.required && (field.array || !typeRequired) ? `${list}!` : list;
}

function selectionSet(field: SignatureField): string {
  const fields = field.type?.fields ?? [];
  if (fields.length === 0) return "";
  return ` { ${fields.map((child) => `${child.name}${selectionSet(child)}`).join(" ")} }`;
}

/**
 * Build the GraphQL operation calling a resolver, from the same inputs and
 * response its registration sends so the two cannot drift.
 * @param resolver - Parsed resolver definition
 * @returns The root field and the document to send
 */
export function buildResolverOperation(resolver: Resolver): ResolverOperation {
  const { inputs, response } = buildResolverSignature(resolver);
  const fields = inputs as SignatureField[];
  const variables = fields.map((input) => `$${input.name}: ${typeReference(input)}`).join(", ");
  const args = fields.map((input) => `${input.name}: $${input.name}`).join(", ");
  const selection = selectionSet(response as SignatureField);
  return {
    field: resolver.name,
    document:
      `${resolver.operation} ${resolver.name}${variables && `(${variables})`} ` +
      `{ ${resolver.name}${args && `(${args})`}${selection} }`,
  };
}
