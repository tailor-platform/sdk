import { TailorDBType } from "@/services/tailordb/schema";
import { measure } from "@/performance";
import { KyselyTypeMetadata } from "./types";
import multiline from "multiline-ts";

/**
 * TailorDBTypeをKysely型メタデータに変換するプロセッサー
 */
export class TypeProcessor {
  /**
   * TailorDBTypeをKyselyTypeMetadataに変換
   */
  @measure
  static async processType(type: TailorDBType): Promise<KyselyTypeMetadata> {
    const typeDef = this.generateTableInterface(type);

    return {
      name: type.name,
      typeDef,
    };
  }

  /**
   * テーブルインターフェースを生成
   */
  private static generateTableInterface(type: TailorDBType): string {
    const ignoreFields = [
      "id",
      ...(type.options?.withTimestamps ? ["createdAt", "updatedAt"] : []),
    ];

    const fields: string[] = ["id: Generated<string>;"];
    for (const [fieldName, fieldDef] of Object.entries(type.fields)) {
      if (ignoreFields.includes(fieldName)) {
        continue;
      }

      const kyselyType = this.mapTailorDBTypeToKysely(fieldDef);
      const nullable = this.isOptional(fieldDef);
      const finalType = nullable ? `${kyselyType} | null` : kyselyType;

      fields.push(`${fieldName}: ${finalType};`);
    }

    if (type.options?.withTimestamps) {
      fields.push("createdAt: Timestamp;");
      fields.push("updatedAt: Timestamp | null;");
    }

    return multiline/* ts */ `
      export interface ${type.name} {
        ${fields.join("\n")}
      }
    `;
  }

  static async processTypes(
    types: Record<string, KyselyTypeMetadata>,
  ): Promise<string> {
    const joinedTypes = await Promise.all(
      Object.values(types).map((type) => type.typeDef),
    ).then((defs) => defs.join("\n\n"));
    return (
      [
        COMMON_PREFIX,
        joinedTypes,
        TypeProcessor.generateDBInterface(Object.values(types)),
        COMMON_SUFFIX,
      ].join("\n\n") + "\n"
    );
  }

  /**
   * DBインターフェースを生成
   */
  private static generateDBInterface(types: KyselyTypeMetadata[]): string {
    return multiline/* ts */ `
      interface DB {
        ${types.map((type) => `${type.name}: ${type.name};`).join("\n")}
      }
    `;
  }

  /**
   * TailorDBの型をKysely型にマッピング
   */
  private static mapTailorDBTypeToKysely(fieldDef: any): string {
    // メタデータから型情報を取得
    const metadata = fieldDef.metadata || fieldDef._metadata;
    const fieldType = metadata?.type;

    switch (fieldType) {
      case "uuid":
      case "string":
        return "string";
      case "integer":
      case "float":
        return "number";
      case "date":
      case "datetime":
        return "Timestamp";
      case "bool":
        return "boolean";
      case "enum": {
        const allowedValues =
          metadata?.allowedValues ||
          metadata?.values ||
          metadata?.enum ||
          fieldDef?.allowedValues ||
          fieldDef?.values ||
          fieldDef?.enum;

        if (allowedValues && Array.isArray(allowedValues)) {
          return allowedValues.map((v) => `"${v.value}"`).join(" | ");
        }
        return "string";
      }
      default:
        return "string"; // デフォルトはstring
    }
  }

  /**
   * フィールドがオプショナルかどうかを判定
   */
  private static isOptional(fieldDef: any): boolean {
    const metadata = fieldDef.metadata || fieldDef._metadata;
    // requiredがtrueでない場合はオプショナル（requiredがfalseまたは未定義）
    return metadata?.required !== true;
  }
}

const COMMON_PREFIX = multiline/* ts */ `
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
`;

const COMMON_SUFFIX = multiline/* ts */ `
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
`;
