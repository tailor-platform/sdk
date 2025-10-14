import { type TailorDBType } from "@/configure/services/tailordb/schema";
import { type KyselyTypeMetadata } from "./types";
import multiline from "multiline-ts";

/**
 * Processor that converts a TailorDBType into Kysely type metadata.
 */
export class TypeProcessor {
  /**
   * Convert a TailorDBType into KyselyTypeMetadata.
   */
  static async processType(type: TailorDBType): Promise<KyselyTypeMetadata> {
    const typeDef = this.generateTableInterface(type);

    return {
      name: type.name,
      typeDef,
    };
  }

  /**
   * Generate the table interface.
   */
  private static generateTableInterface(type: TailorDBType): string {
    const fields: string[] = ["id: Generated<string>;"];
    for (const [fieldName, fieldDef] of Object.entries(type.fields)) {
      if (fieldName === "id") {
        continue;
      }

      const fieldType = this.generateFieldType(fieldDef);
      fields.push(`${fieldName}: ${fieldType};`);
    }

    return multiline /* ts */ `
      export interface ${type.name} {
        ${fields.join("\n")}
      }
    `;
  }

  /**
   * Generate the complete field type including array and null modifiers.
   */
  private static generateFieldType(fieldDef: any): string {
    const metadata = fieldDef.metadata;
    const baseType = this.getBaseType(fieldDef);
    const isArray = metadata?.array === true;
    const isNullable = metadata?.required !== true;
    const isAssertNonNull = metadata?.assertNonNull === true;

    let finalType = baseType;
    if (isArray) {
      finalType = `${baseType}[]`;
    }
    if (isNullable) {
      if (isAssertNonNull) {
        finalType = `AssertNonNull<${finalType}>`;
      } else {
        finalType = `${finalType} | null`;
      }
    }

    return finalType;
  }

  /**
   * Get the base Kysely type for a field (without array/null modifiers).
   */
  private static getBaseType(fieldDef: any): string {
    const metadata = fieldDef.metadata;
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
      case "boolean":
        return "boolean";
      case "enum":
        return this.getEnumType(metadata, fieldDef);
      case "nested":
        return this.getNestedType(fieldDef);
      default:
        return "string";
    }
  }

  /**
   * Get the enum type definition.
   */
  private static getEnumType(metadata: any, fieldDef: any): string {
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

  /**
   * Get the nested object type definition.
   */
  private static getNestedType(fieldDef: any): string {
    const fields = fieldDef.fields;
    if (!fields || typeof fields !== "object") {
      return "string";
    }

    const fieldTypes: string[] = [];
    for (const [fieldName, nestedFieldDef] of Object.entries(fields)) {
      const fieldType = this.generateFieldType(nestedFieldDef);
      fieldTypes.push(`${fieldName}: ${fieldType}`);
    }

    return `{\n  ${fieldTypes.join(";\n  ")}${fieldTypes.length > 0 ? ";" : ""}\n}`;
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
   * Generate the DB interface.
   */
  private static generateDBInterface(types: KyselyTypeMetadata[]): string {
    return multiline /* ts */ `
      export interface DB {
        ${types.map((type) => `${type.name}: ${type.name};`).join("\n")}
      }
    `;
  }
}

const COMMON_PREFIX = multiline /* ts */ `
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

  type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<S, I | undefined, U>
    : ColumnType<T, T | undefined, T>;
  type Timestamp = ColumnType<Date, Date | string, Date | string>;
  type AssertNonNull<T> = T extends ColumnType<infer S, infer I, infer U>
    ? ColumnType<NonNullable<S>, I | null, U | null>
    : ColumnType<NonNullable<T>, T | null, T | null>
`;

const COMMON_SUFFIX = multiline /* ts */ `
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
`;
