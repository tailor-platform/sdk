import {
  ColumnType,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";

export type ArrayType<T> = ArrayTypeImpl<T> extends (infer U)[]
  ? U[]
  : ArrayTypeImpl<T>;
export type ArrayTypeImpl<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S[], I[], U[]>
  : T[];
export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
export type Json = JsonValue;
export type JsonArray = JsonValue[];
export type JsonObject = {
  [x: string]: JsonValue | undefined;
};
export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;

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

export interface DB {
  Customer: Customer;
  PurchaseOrder: PurchaseOrder;
  Role: Role;
  SalesOrder: SalesOrder;
  Supplier: Supplier;
  User: User;
}

export const getDB = () => {
  return new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db: Kysely<unknown>) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
};
