// TailorDB replication configuration input types.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type {
  TailorDBReplicationDestinationInput,
  TailorDBReplicationSettingsInput,
} from "#/types/tailordb-replication.generated";

declare const tailorDBReplicationDestinationDefinitionBrand: unique symbol;
type TailorDBReplicationDestinationDefinitionBrand = {
  readonly [tailorDBReplicationDestinationDefinitionBrand]: true;
};

/** Destination accepted by `defineTailorDBReplicationDestination()`. */
export type TailorDBReplicationDestinationServiceInput = Omit<
  TailorDBReplicationDestinationInput,
  "name"
>;

/** Type accepted by a replication's `destination` and by `AppConfig.dbReplicationDestinations`. Only values returned by `defineTailorDBReplicationDestination()` satisfy this. */
export type TailorDBReplicationDestinationConfig = TailorDBReplicationDestinationInput &
  TailorDBReplicationDestinationDefinitionBrand;

/** A replication of a TailorDB namespace's tables, keyed by its name in the namespace's `replications`. */
export type TailorDBReplicationConfig = Omit<TailorDBReplicationSettingsInput, "destination"> & {
  /** Destination to write into, as returned by `defineTailorDBReplicationDestination()`. It is deployed with the replication. */
  destination: TailorDBReplicationDestinationConfig;
};

/**
 * Replications of a TailorDB namespace, keyed by replication name. A replication whose value is
 * `undefined` is declared but not deployed, so tables can name it in `targets` in every environment.
 */
export type TailorDBReplicationsConfig = Record<string, TailorDBReplicationConfig | undefined>;

type ReplicableFieldName<Fields> = Exclude<keyof Fields & string, "id">;

type IncludableFieldName<Fields> = {
  [K in ReplicableFieldName<Fields>]: Fields[K] extends { _defined: { vector: true } } ? never : K;
}[ReplicableFieldName<Fields>];

type TailorDBTableReplicationFields<Fields> =
  | { excludeFields: ReplicableFieldName<Fields>[]; includeFields?: never }
  | { includeFields: IncludableFieldName<Fields>[]; excludeFields?: never }
  | { excludeFields?: never; includeFields?: never };

/**
 * How replications of the namespace copy a table, passed to `.replication()`. List at most one
 * of `excludeFields` and `includeFields`; with neither, every field is copied. Vector fields are
 * never replicated, so `includeFields` cannot list them.
 */
export type TailorDBTableReplication<Fields> = TailorDBTableReplicationFields<Fields> & {
  /** Replications of the namespace that copy the table; every one when omitted. */
  targets?: string[];
};
