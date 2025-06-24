import { SqlClient } from "@tailor-platform/tailor-sdk";
import {
  ColumnType,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from "kysely";

type ArrayType<T> = ArrayTypeImpl<T> extends (infer U)[]
  ? U[]
  : ArrayTypeImpl<T>;
type ArrayTypeImpl<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S[], I[], U[]>
  : T[];
type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
type Json = JsonValue;
type JsonArray = JsonValue[];
type JsonObject = {
  [x: string]: JsonValue | undefined;
};
type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonArray | JsonObject | JsonPrimitive;
type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface Customer {
  id: Generated<string>;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string;
  country: string;
  postalCode: string;
  createdAt: Timestamp;
  updatedAt: Timestamp | null;
}

export interface PurchaseOrder {
  id: Generated<string>;
  supplierID: string;
  totalPrice: number;
  discount: number | null;
  status: string;
  createdAt: Timestamp;
  updatedAt: Timestamp | null;
}

export interface Role {
  id: Generated<string>;
  name: string;
}

export interface SalesOrder {
  id: Generated<string>;
  customerID: string;
  totalPrice: number | null;
  discount: number | null;
  status: string | null;
  cancelReason: string | null;
  canceledAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp | null;
}

export interface Supplier {
  id: Generated<string>;
  name: string;
  phone: string;
  fax: string | null;
  email: string | null;
  postalCode: string;
  country: string;
  state: "Alabama" | "Alaska";
  city: string;
  createdAt: Timestamp;
  updatedAt: Timestamp | null;
}

export interface User {
  id: Generated<string>;
  name: string;
  email: string;
  createdAt: Timestamp;
  updatedAt: Timestamp | null;
}

interface DB {
  Customer: Customer;
  PurchaseOrder: PurchaseOrder;
  Role: Role;
  SalesOrder: SalesOrder;
  Supplier: Supplier;
  User: User;
}

const getDB = () => {
  return new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
};

type QueryReturnType<T> = T extends CompiledQuery<infer U> ? U : never;

export async function kyselyWrapper<const C extends { client: SqlClient }, R>(
  context: C,
  callback: (
    context: Omit<C, "client"> & {
      db: ReturnType<typeof getDB>;
      client: {
        exec: <Q extends CompiledQuery>(
          query: Q,
        ) => Promise<QueryReturnType<Q>[]>;
      };
    },
  ) => Promise<R>,
) {
  const db = getDB();
  const clientWrapper = {
    exec: async <Q extends CompiledQuery>(query: Q) => {
      return await context.client.exec<QueryReturnType<Q>[]>(query.sql);
    },
  };

  return await callback({ ...context, db, client: clientWrapper });
}
