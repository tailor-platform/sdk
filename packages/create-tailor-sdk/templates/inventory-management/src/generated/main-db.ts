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

export interface Category {
  id: Generated<string>;
  name: string;
  description: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Contact {
  id: Generated<string>;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Inventory {
  id: Generated<string>;
  productId: string;
  quantity: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Notification {
  id: Generated<string>;
  message: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Order {
  id: Generated<string>;
  name: string;
  description: string | null;
  orderDate: Timestamp;
  orderType: "PURCHASE" | "SALES";
  contactId: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface OrderItem {
  id: Generated<string>;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Product {
  id: Generated<string>;
  name: string;
  description: string | null;
  categoryId: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface User {
  id: Generated<string>;
  name: string;
  email: string;
  role: "MANAGER" | "STAFF";
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface DB {
  Category: Category;
  Contact: Contact;
  Inventory: Inventory;
  Notification: Notification;
  Order: Order;
  OrderItem: OrderItem;
  Product: Product;
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
      return await context.client.exec<QueryReturnType<Q>[]>(query.sql, query.parameters);
    },
  };

  return await callback({ ...context, db, client: clientWrapper });
}
