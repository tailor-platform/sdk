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
  country: string;
  postalCode: string;
  address: string | null;
  city: string | null;
  fullAddress: string | null;
  state: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Invoice {
  id: Generated<string>;
  invoiceNumber: string | null;
  salesOrderID: string;
  amount: number | null;
  sequentialId: number | null;
  status: "draft" | "sent" | "paid" | "cancelled" | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface NestedProfile {
  id: Generated<string>;
  userInfo: {
    personal: {
      name: string;
      age: number | null;
      bio: string | null;
    };
    contact: {
      email: string;
      phone: string | null;
      address: {
        street: string;
        city: string;
        country: string;
        coordinates: {
          latitude: number;
          longitude: number;
        } | null;
      };
    };
    preferences: {
      notifications: {
        email: boolean;
        sms: boolean;
        push: boolean;
      };
      privacy: {
        profileVisible: boolean;
        dataSharing: boolean;
      } | null;
    } | null;
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
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Role {
  id: Generated<string>;
  name: string;
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
  createdAt: Timestamp | null;
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
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface User {
  id: Generated<string>;
  name: string;
  email: string;
  status: string | null;
  department: string | null;
  roleId: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface UserSetting {
  id: Generated<string>;
  language: "jp" | "en";
  userID: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface DB {
  Customer: Customer;
  Invoice: Invoice;
  NestedProfile: NestedProfile;
  PurchaseOrder: PurchaseOrder;
  Role: Role;
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
