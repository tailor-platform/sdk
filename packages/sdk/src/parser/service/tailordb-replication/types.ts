// Parsed TailorDB replication types shared by the parser and the CLI.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.

/** One table a replication copies, and the fields it copies. */
export type TailorDBReplicationType = {
  name: string;
  excludeFields?: string[] | undefined;
  includeFields?: string[] | undefined;
};

/** A replication resolved from its namespace's `replications` and its tables' `.replication()`. */
export type TailorDBReplication = {
  name: string;
  source: { namespace: string };
  /** Name of the destination to write into. */
  destination: string;
  tablePrefix?: string | undefined;
  enabled: boolean;
  types: TailorDBReplicationType[];
};
