import {
  type ColumnType,
  Kysely,
  type KyselyConfig,
  type Transaction as KyselyTransaction,
  type Insertable as KyselyInsertable,
  type Selectable as KyselySelectable,
  type Updateable as KyselyUpdateable,
  TailordbDialect,
} from "@tailor-platform/sdk/kysely";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export interface Namespace {
  "main-db": {
    Category: {
      id: Generated<string>;
      name: string;
      description: string | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    Contact: {
      id: Generated<string>;
      name: string;
      email: string;
      phone: string | null;
      address: string | null;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    Inventory: {
      id: Generated<string>;
      productId: string;
      quantity: number;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    Notification: {
      id: Generated<string>;
      message: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    Order: {
      id: Generated<string>;
      name: string;
      description: string | null;
      orderDate: Timestamp;
      orderType: "PURCHASE" | "SALES";
      contactId: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    OrderItem: {
      id: Generated<string>;
      orderId: string;
      productId: string;
      quantity: number;
      unitPrice: number;
      totalPrice: Generated<number | null>;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    Product: {
      id: Generated<string>;
      name: string;
      description: string | null;
      categoryId: string;
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }

    User: {
      id: Generated<string>;
      name: string;
      email: string;
      role: "MANAGER" | "STAFF";
      createdAt: Generated<Timestamp>;
      updatedAt: Timestamp | null;
    }
  }
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

export type Transaction<K extends keyof Namespace | DB = keyof Namespace> =
  K extends DB<infer N>
    ? KyselyTransaction<Namespace[N]>
    : K extends keyof Namespace
      ? KyselyTransaction<Namespace[K]>
      : never;

type TableName = {
  [N in keyof Namespace]: keyof Namespace[N];
}[keyof Namespace];
export type Table<T extends TableName> = {
  [N in keyof Namespace]: T extends keyof Namespace[N] ? Namespace[N][T]
    : never;
}[keyof Namespace];

export type Insertable<T extends keyof Namespace[keyof Namespace]> = KyselyInsertable<
  Table<T>
>;
export type Selectable<T extends keyof Namespace[keyof Namespace]> = KyselySelectable<
  Table<T>
>;
export type Updateable<T extends keyof Namespace[keyof Namespace]> = KyselyUpdateable<
  Table<T>
>;
