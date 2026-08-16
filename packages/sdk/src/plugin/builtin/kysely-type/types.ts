/**
 * Type definitions dedicated to Kysely type generation.
 */

/**
 * Minimal structural field shape the Kysely type generator reads. Both parsed
 * TailorDB field configs and migration schema-snapshot field configs are
 * assignable to it.
 */
export interface KyselyFieldConfig {
  type: string;
  required?: boolean;
  array?: boolean;
  allowedValues?: readonly (string | { value: string })[];
  serial?: unknown;
  default?: unknown;
  hooks?: {
    create?: object;
    update?: object;
  };
  fields?: Record<string, KyselyFieldConfig>;
}

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
