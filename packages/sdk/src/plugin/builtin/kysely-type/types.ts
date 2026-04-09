/**
 * Type definitions dedicated to Kysely type generation.
 */

export interface KyselyTypeMetadata {
  name: string;
  typeDef: string;
  usedUtilityTypes: {
    Timestamp: boolean;
    Serial: boolean;
  };
}

export interface KyselyNamespaceMetadata {
  namespace: string;
  types: KyselyTypeMetadata[];
  usedUtilityTypes: {
    Timestamp: boolean;
    Serial: boolean;
  };
}
