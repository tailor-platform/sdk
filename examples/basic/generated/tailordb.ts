import { type SqlClient } from "@tailor-platform/tailor-sdk";
import {
  type ColumnType,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from "kysely";

type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;
type Timestamp = ColumnType<Date, Date | string, Date | string>;
type AssertNonNull<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<NonNullable<S>, I | null, U | null>
  : ColumnType<NonNullable<T>, T | null, T | null>

export interface Customer {
  id: Generated<string>;
  name: string;
  email: string;
  phone: string | null;
  country: string;
  postalCode: string;
  address: string | null;
  city: string | null;
  fullAddress: string | null;
  state: string;
  createdAt: AssertNonNull<Timestamp>;
  updatedAt: Timestamp | null;
}

export interface Invoice {
  id: Generated<string>;
  invoiceNumber: string | null;
  salesOrderID: string;
  amount: number | null;
  sequentialId: number | null;
  status: "draft" | "sent" | "paid" | "cancelled" | null;
  createdAt: AssertNonNull<Timestamp>;
  updatedAt: Timestamp | null;
}

export interface NestedProfile {
  id: Generated<string>;
  userInfo: {
    name: string;
    age: number | null;
    bio: string | null;
    email: string;
    phone: string | null;
  };
  metadata: {
    created: Timestamp;
    lastUpdated: Timestamp | null;
    version: number;
  };
  archived: boolean | null;
}

export interface PurchaseOrder {
  id: Generated<string>;
  supplierID: string;
  totalPrice: number;
  discount: number | null;
  status: string;
  attachedFiles: {
    id: string;
    name: string;
    size: number;
    type: "text" | "image";
  }[];
  createdAt: AssertNonNull<Timestamp>;
  updatedAt: Timestamp | null;
}

export interface SalesOrder {
  id: Generated<string>;
  customerID: string;
  approvedByUserIDs: string[] | null;
  totalPrice: number | null;
  discount: number | null;
  status: string | null;
  cancelReason: string | null;
  canceledAt: Timestamp | null;
  createdAt: AssertNonNull<Timestamp>;
  updatedAt: Timestamp | null;
}

export interface SalesOrderCreated {
  id: Generated<string>;
  salesOrderID: string;
  customerID: string;
  totalPrice: number | null;
  status: string | null;
}

export interface Selfie {
  id: Generated<string>;
  name: string;
  parentID: string | null;
  dependId: string | null;
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
  createdAt: AssertNonNull<Timestamp>;
  updatedAt: Timestamp | null;
}

export interface User {
  id: Generated<string>;
  name: string;
  email: string;
  status: string | null;
  department: string | null;
  role: "ADMIN" | "USER";
  createdAt: AssertNonNull<Timestamp>;
  updatedAt: Timestamp | null;
}

export interface UserSetting {
  id: Generated<string>;
  language: "jp" | "en";
  userID: string;
  createdAt: AssertNonNull<Timestamp>;
  updatedAt: Timestamp | null;
}

export interface DB {
  Customer: Customer;
  Invoice: Invoice;
  NestedProfile: NestedProfile;
  PurchaseOrder: PurchaseOrder;
  SalesOrder: SalesOrder;
  SalesOrderCreated: SalesOrderCreated;
  Selfie: Selfie;
  Supplier: Supplier;
  User: User;
  UserSetting: UserSetting;
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
