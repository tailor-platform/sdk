import type { EnumDefinition } from "./types";

/**
 * Generate enum constant definitions from collected metadata.
 * @param allEnums - All collected enum definitions
 * @returns Generated enum constant definitions
 */
export function generateUnifiedEnumConstants(allEnums: EnumDefinition[]): string {
  if (allEnums.length === 0) {
    return "";
  }

  const enumMap = new Map<string, EnumDefinition>();
  for (const enumDef of allEnums) {
    enumMap.set(enumDef.name, enumDef);
  }

  const enumDefs = Array.from(enumMap.values())
    .map((e) => {
      const members = e.values
        .map((v) => {
          const key = v.value.replace(/[-\s]/g, "_");
          return `  "${key}": "${v.value}"`;
        })
        .join(",\n");

      const hasDescriptions = e.values.some((v) => v.description);
      let jsDoc = "";
      if (e.fieldDescription || hasDescriptions) {
        const lines: string[] = [];

        if (e.fieldDescription) {
          lines.push(` * ${e.fieldDescription}`);
          if (hasDescriptions) {
            lines.push(" *");
          }
        }

        if (hasDescriptions) {
          const propertyDocs = e.values.map((v) => {
            const key = v.value.replace(/[-\s]/g, "_");
            return ` * @property ${[key, v.description].filter(Boolean).join(" - ")}`;
          });
          lines.push(...propertyDocs);
        }

        if (lines.length > 0) {
          jsDoc = `/**\n${lines.join("\n")}\n */\n`;
        }
      }

      const constDef = `${jsDoc}export const ${e.name} = {\n${members}\n} as const;`;
      const typeDef = `export type ${e.name} = (typeof ${e.name})[keyof typeof ${e.name}];`;
      return `${constDef}\n${typeDef}`;
    })
    .join("\n\n");

  if (!enumDefs) {
    return "";
  }

  return enumDefs + "\n";
}
