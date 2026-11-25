// TailorDB replication configuration input types.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type { TailorAnyDBField, TailorDBType } from "#/configure/services/tailordb/types";
import type {
  TailorDBReplicationDestinationInput,
  TailorDBReplicationInput,
  TailorDBReplicationTypeInput,
} from "#/types/tailordb-replication.generated";

declare const tailorDBReplicationDestinationDefinitionBrand: unique symbol;
type TailorDBReplicationDestinationDefinitionBrand = {
  readonly [tailorDBReplicationDestinationDefinitionBrand]: true;
};

declare const tailorDBReplicationDefinitionBrand: unique symbol;
type TailorDBReplicationDefinitionBrand = {
  readonly [tailorDBReplicationDefinitionBrand]: true;
};

/** Destination accepted by `defineTailorDBReplicationDestination()`. */
export type TailorDBReplicationDestinationServiceInput = Omit<
  TailorDBReplicationDestinationInput,
  "name"
>;

/** Type accepted by `destination` of a replication and by `AppConfig.dbReplicationDestinations`. Only values returned by `defineTailorDBReplicationDestination()` satisfy this. */
export type TailorDBReplicationDestinationConfig = TailorDBReplicationDestinationInput &
  TailorDBReplicationDestinationDefinitionBrand;

/** Replication settings accepted by `defineTailorDBReplication()`. Types are added with `.add()`. */
export type TailorDBReplicationServiceInput = Omit<
  TailorDBReplicationInput,
  "name" | "types" | "destination"
> & {
  /** Destination to write into, as returned by `defineTailorDBReplicationDestination()`. It is deployed with the replication. */
  destination: TailorDBReplicationDestinationConfig;
};

type ReplicableFieldName<Fields> = Exclude<keyof Fields & string, "id">;

type IncludableFieldName<Fields> = {
  [K in ReplicableFieldName<Fields>]: Fields[K] extends { _defined: { vector: true } } ? never : K;
}[ReplicableFieldName<Fields>];

/**
 * Fields of one replicated type. List at most one of `excludeFields` and
 * `includeFields`; with neither, every field is replicated. Vector fields are
 * never replicated, so `includeFields` cannot list them.
 */
export type TailorDBReplicationTypeOptions<Fields> =
  | { excludeFields: ReplicableFieldName<Fields>[]; includeFields?: never }
  | { includeFields: IncludableFieldName<Fields>[]; excludeFields?: never }
  | { excludeFields?: never; includeFields?: never };

/** Replication returned by `defineTailorDBReplication()` and `.add()`. */
export interface TailorDBReplicationDefinition extends TailorDBReplicationServiceInput {
  readonly name: string;
  readonly types: TailorDBReplicationTypeInput[];
  /**
   * Return a copy of this replication that also replicates `type`.
   * @param type - TailorDB type loaded by the source namespace's `files`
   * @param options - Fields to replicate; every field when omitted
   * @returns A new replication; this one is left unchanged
   */
  add<Fields extends Record<string, TailorAnyDBField>>(
    type: TailorDBType<Fields>,
    options?: TailorDBReplicationTypeOptions<Fields>,
  ): TailorDBReplicationDefinition & TailorDBReplicationDefinitionBrand;
}

/** Type accepted by `AppConfig.dbReplications`. Only values returned by `defineTailorDBReplication()` satisfy this. */
export type TailorDBReplicationConfig = TailorDBReplicationDefinition &
  TailorDBReplicationDefinitionBrand;
