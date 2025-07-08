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
    const fields: string[] = ["id: Generated<string>;"];
    for (const [fieldName, fieldDef] of Object.entries(type.fields)) {
      if (fieldName === "id") {
        continue;
      }

      const kyselyType = this.mapTailorDBTypeToKysely(fieldDef);
      const nullable = this.isOptional(fieldDef);
      const isArray = this.isArray(fieldDef);

      let finalType = kyselyType;
      if (isArray) {
        finalType = `${kyselyType}[]`;
      }
      if (nullable) {
        finalType = `${finalType} | null`;
      }

      fields.push(`${fieldName}: ${finalType};`);
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
    const metadata = fieldDef.metadata;
    const fieldType = metadata?.type;

    switch (fieldType) {
      case "uuid":
        return "string";
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
      case "nested": {
        // nestedの場合、fieldsプロパティからネストした型を生成
        const fields = fieldDef.fields || (fieldDef as any).fields;
        if (fields && typeof fields === "object") {
          return this.processNestedObjectType(fields, 1);
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
    const metadata = fieldDef.metadata;
    if (metadata?.assertNonNull === true) {
      return false;
    }
    return metadata?.required !== true;
  }

  /**
   * フィールドが配列かどうかを判定
   */
  private static isArray(fieldDef: any): boolean {
    const metadata = fieldDef.metadata;
    return metadata?.array === true;
  }

  /**
   * ネストしたオブジェクト型を再帰的に処理
   */
  private static processNestedObjectType(
    fields: any,
    indentLevel: number,
  ): string {
    const indent = "  ".repeat(indentLevel);
    const objectFields: string[] = [];

    for (const [fieldName, nestedFieldDef] of Object.entries(fields)) {
      const nestedMetadata = (nestedFieldDef as any).metadata;

      if (nestedMetadata.type === "nested" && (nestedFieldDef as any).fields) {
        const nestedObjectType = this.processNestedObjectType(
          (nestedFieldDef as any).fields,
          indentLevel + 1,
        );
        const nestedNullable = this.isOptional(nestedFieldDef as any);
        const finalNestedType = nestedNullable
          ? `${nestedObjectType} | null`
          : nestedObjectType;
        objectFields.push(`${fieldName}: ${finalNestedType};`);
      } else {
        const nestedType = this.mapTailorDBTypeToKysely(nestedFieldDef as any);
        const nestedNullable = this.isOptional(nestedFieldDef as any);
        const finalNestedType = nestedNullable
          ? `${nestedType} | null`
          : nestedType;
        objectFields.push(`${fieldName}: ${finalNestedType};`);
      }
    }

    return `{\n${indent}${objectFields.join(`\n${indent}`)}\n${"  ".repeat(
      indentLevel - 1,
    )}}`;
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
