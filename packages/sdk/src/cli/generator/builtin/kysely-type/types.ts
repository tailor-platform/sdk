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
