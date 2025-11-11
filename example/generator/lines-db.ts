import path from "node:path";
import ml from "multiline-ts";
import type {
  CodeGenerator,
  Executor,
  GeneratorInput,
  GeneratorResult,
} from "@tailor-platform/tailor-sdk/cli";
import type { ForeignKeyDefinition, IndexDefinition } from "@toiroakr/lines-db";

interface TypeResult {
  typeName: string;
  exportName: string;
  importPath: string;
  optionalFields: string[];
  foreignKeys: ForeignKeyDefinition[];
  indexes: IndexDefinition[];
}

export const linesDbGenerator: CodeGenerator<
  TypeResult,
  undefined,
  undefined,
  Record<string, TypeResult>,
  undefined
> = {
  id: "lines-db",
  description: "generator for lines-db schema",
  processType: ({ type, source }) => {
    if (!source.filePath || !source.exportName) {
      throw new Error(`Missing source info for type ${type.name}`);
    }

    const optionalFields = ["id"]; // id is always optional
    const indexes: IndexDefinition[] = [];
    const foreignKeys: ForeignKeyDefinition[] = [];

    for (const [fieldName, field] of Object.entries(type.fields)) {
      // Find fields with hooks.create
      if (field.config.hooks?.create) {
        optionalFields.push(fieldName);
      }
      if (field.config.unique) {
        indexes.push({
          name: `${type.name.toLowerCase()}_${fieldName}_unique_idx`,
          columns: [fieldName],
          unique: true,
        });
      }
    }

    // Extract indexes
    if (type.indexes) {
      for (const [indexName, indexDef] of Object.entries(type.indexes)) {
        indexes.push({
          name: indexName,
          columns: indexDef.fields,
          unique: indexDef.unique,
        });
      }
    }

    // Extract foreign keys from relations
    for (const [fieldName, field] of Object.entries(type.fields)) {
      if (field.relation) {
        foreignKeys.push({
          column: fieldName,
          references: {
            table: field.relation.targetType,
            column: field.relation.key,
          },
        });
      }
    }

    return {
      typeName: type.name,
      exportName: source.exportName,
      importPath: source.filePath,
      optionalFields,
      foreignKeys,
      indexes,
    };
  },
  processTailorDBNamespace({ types }: { types: Record<string, TypeResult> }) {
    return types;
  },
  processExecutor: (_executor: Executor) => undefined,
  processResolver: (_args) => undefined,
  aggregate({
    inputs,
  }: {
    inputs: GeneratorInput<Record<string, TypeResult>, undefined>[];
  }): GeneratorResult {
    const files = inputs.flatMap(({ tailordb }) =>
      tailordb.flatMap(({ types }) => {
        return Object.values(types).map((typeResult) => {
          const outputPath = path.join(
            "seed",
            "data",
            `${typeResult.typeName}.schema.ts`,
          );
          const importPath = path.relative(
            path.dirname(outputPath),
            typeResult.importPath,
          );
          const normalizedImportPath = importPath
            .replace(/\.ts$/, "")
            .startsWith(".")
            ? importPath.replace(/\.ts$/, "")
            : `./${importPath.replace(/\.ts$/, "")}`;

          const content = generateSchemaFile(typeResult, normalizedImportPath);

          return {
            path: outputPath,
            content,
          };
        });
      }),
    );

    return { files };
  },
};

function generateSchemaFile(
  typeResult: TypeResult,
  importPath: string,
): string {
  const { exportName, optionalFields, foreignKeys, indexes } = typeResult;

  const pickFieldsArray = JSON.stringify(optionalFields);
  const schemaTypeCode = ml /* ts */ `
    const schemaType = t.object({
      ...${exportName}.pickFields(${pickFieldsArray}, { optional: true }),
      ...${exportName}.omitFields(${pickFieldsArray}),
    });
    `;

  // Generate SchemaOptions
  const schemaOptions: string[] = [];

  if (foreignKeys.length > 0) {
    schemaOptions.push(`foreignKeys: [`);
    foreignKeys.forEach((fk) => {
      schemaOptions.push(`  ${JSON.stringify(fk)},`);
    });
    schemaOptions.push(`],`);
  }

  if (indexes.length > 0) {
    schemaOptions.push(`indexes: [`);
    indexes.forEach((index) => {
      schemaOptions.push(`  ${JSON.stringify(index)},`);
    });
    schemaOptions.push("],");
  }

  return ml /* ts */ `
    import { t } from "@tailor-platform/tailor-sdk";
    import { defineSchema } from "@toiroakr/lines-db";
    import { ${exportName} } from "${importPath}";

    ${schemaTypeCode}

    const contextUser = {
      id: "",
      type: "",
      workspaceId: process.env.TAILOR_WORKSPACE_ID ?? "",
      attributes: null,
      attributeList: [],
    } as const satisfies Parameters<typeof schemaType.parse>[0]["user"];

    const hook = (data: unknown) => {
      return Object.entries(${exportName}.fields).reduce(
        (hooked, [key, value]) => {
          if (key === "id") {
            hooked[key] = crypto.randomUUID();
          } else if (value.type === "nested") {
            hooked[key] = hook((data as Record<string, unknown>)[key]);
          } else if (value.metadata.hooks?.create) {
            hooked[key] = value.metadata.hooks.create({
                  value: (data as Record<string, unknown>)[key],
                  data: data,
                  user: contextUser,
                });
          } else if (data && typeof data === "object") {
            hooked[key] = (data as Record<string, unknown>)[key];
          }
          return hooked;
        },
        {} as Record<string, unknown>,
      ) as t.infer<typeof schemaType>;
    };

    export const schema = defineSchema(
      {
        "~standard": {
          version: 1,
          vendor: "@tailor-platform/tailor-sdk",
          validate: (value) => {
            const hooked = hook(value);
            const result = schemaType.parse({
              value: hooked,
              data: hooked,
              user: contextUser,
            });
            if (result.issues) {
              return result;
            }
            return { value: hooked };
          },
        },
      },${
        schemaOptions.length > 0
          ? [
              "\n  {",
              ...schemaOptions.map((option) => `    ${option}`),
              "  }",
            ].join("\n")
          : ""
      }
    );
    `;
}
