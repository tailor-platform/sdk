import { type ColumnType, Kysely, type KyselyConfig } from "kysely";
import { TailordbDialect } from "@tailor-platform/function-kysely-tailordb";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;

export interface Namespace {
  "main-db": {
    User: {
      id: Generated<string>;
      name: string;
      email: string;
      age: number;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    };
  };
}

export function getDB<const N extends keyof Namespace>(
  namespace: N,
  kyselyConfig?: Omit<KyselyConfig, "dialect">,
): Kysely<Namespace[N]> {
  const client = new tailordb.Client({ namespace });
  return new Kysely<Namespace[N]>({
    dialect: new TailordbDialect(client),
    ...kyselyConfig,
  });
}

export type DB<N extends keyof Namespace = keyof Namespace> = ReturnType<typeof getDB<N>>;
