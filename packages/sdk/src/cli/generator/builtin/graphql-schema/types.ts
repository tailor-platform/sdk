/**
 * Metadata for a single GraphQL schema entry generated from a TailorDB type.
 */
export type GqlSchemaEntryMetadata = {
  /** Operation name (e.g., "createUser", "user", "users") */
  operationName: string;
  /** Variables type expression (e.g., '{ input: InferCreateInput<...> }') */
  variablesExpr: string;
  /** Result type expression (e.g., '{ createUser: InferGqlResult<...> }') */
  resultExpr: string;
};

/**
 * Metadata for a single TailorDB type processed for GraphQL schema generation.
 */
export type GqlSchemaTypeMetadata = {
  /** Type name (e.g., "User") */
  name: string;
  /** Generated GraphQL operation entries for this type */
  entries: GqlSchemaEntryMetadata[];
};
