/**
 * i18n Generator
 *
 * Generates localized label files from i18n plugin configurations.
 * Produces JSON files for each language with type and field labels.
 *
 * Output structure:
 * ```
 * generated/i18n/
 *   ja.json  - Japanese labels
 *   en.json  - English labels
 *   ...
 * ```
 */

import type { I18nConfig, FieldLabel } from "./plugin";
import type {
  TailorDBInput,
  AggregateArgs,
  GeneratorResult,
  TailorDBType,
  PluginAttachment,
  TypeSourceInfoEntry,
} from "@tailor-platform/sdk/cli";

const I18N_PLUGIN_ID = "@example/i18n";

/**
 * Metadata collected per type
 */
interface I18nTypeMetadata {
  typeName: string;
  namespace: string;
  labels: Partial<Record<string, FieldLabel>>;
  typeLabel?: FieldLabel;
}

/**
 * Metadata collected per namespace
 */
interface I18nNamespaceMetadata {
  namespace: string;
  types: I18nTypeMetadata[];
}

/**
 * Options for the i18n generator
 */
interface I18nGeneratorOptions {
  /** Output directory for generated files (default: "generated/i18n") */
  distPath?: string;
  /** Languages to generate (default: all languages found in configs) */
  languages?: string[];
}

/**
 * Create an i18n generator that produces localized label files.
 * @param options - Generator options
 * @returns TailorDB generator instance
 */
export function createI18nGenerator(options: I18nGeneratorOptions = {}) {
  const distPath = options.distPath ?? "generated/i18n";

  return {
    id: "@example/i18n-generator",
    description: "Generates localized label files from i18n plugin configurations",
    dependencies: ["tailordb"] as ("tailordb" | "resolver" | "executor")[],

    async processType(args: {
      type: TailorDBType;
      namespace: string;
      source: TypeSourceInfoEntry;
      plugins: readonly PluginAttachment[];
    }): Promise<I18nTypeMetadata | null> {
      // Find i18n plugin configuration
      const i18nPlugin = args.plugins.find((p) => p.pluginId === I18N_PLUGIN_ID);
      if (!i18nPlugin) {
        return null;
      }

      const config = i18nPlugin.config as I18nConfig;

      return {
        typeName: args.type.name,
        namespace: args.namespace,
        labels: config.labels ?? {},
        typeLabel: config.typeLabel,
      };
    },

    async processTailorDBNamespace(args: {
      namespace: string;
      types: Record<string, I18nTypeMetadata | null>;
    }): Promise<I18nNamespaceMetadata> {
      // Filter out null values (types without i18n config)
      const typesWithI18n = Object.values(args.types).filter(
        (t): t is I18nTypeMetadata => t !== null,
      );

      return {
        namespace: args.namespace,
        types: typesWithI18n,
      };
    },

    async aggregate(
      args: AggregateArgs<TailorDBInput<I18nNamespaceMetadata>>,
    ): Promise<GeneratorResult> {
      const files: GeneratorResult["files"] = [];

      // Collect all languages and labels from all types
      const allLanguages = new Set<string>();
      const labelsByLanguage: Record<string, Record<string, Record<string, string>>> = {};
      const typeNames = new Set<string>();

      const ensureTypeEntry = (lang: string, typeName: string) => {
        if (!labelsByLanguage[lang]) {
          labelsByLanguage[lang] = {};
        }
        if (!labelsByLanguage[lang][typeName]) {
          labelsByLanguage[lang][typeName] = {};
        }
      };

      for (const { types } of args.input.tailordb) {
        for (const typeMetadata of types.types) {
          // Collect type labels (ensure entry even without field labels)
          for (const [lang, label] of Object.entries(typeMetadata.typeLabel ?? {})) {
            allLanguages.add(lang);
            ensureTypeEntry(lang, typeMetadata.typeName);
            labelsByLanguage[lang][typeMetadata.typeName]._type = label;
            typeNames.add(typeMetadata.typeName);
          }

          // Collect field labels
          for (const [fieldName, fieldLabel] of Object.entries(typeMetadata.labels)) {
            if (!fieldLabel) continue;
            for (const [lang, label] of Object.entries(fieldLabel)) {
              allLanguages.add(lang);
              ensureTypeEntry(lang, typeMetadata.typeName);
              labelsByLanguage[lang][typeMetadata.typeName][fieldName] = label;
              typeNames.add(typeMetadata.typeName);
            }
          }
        }
      }

      // Filter languages if specified in options
      const targetLanguages = options.languages ?? Array.from(allLanguages);

      // Generate JSON file for each language
      for (const lang of targetLanguages) {
        const labels = labelsByLanguage[lang] ?? {};
        files.push({
          path: `${distPath}/${lang}.json`,
          content: JSON.stringify(labels, null, 2) + "\n",
        });
      }

      // Generate TypeScript type definitions for labels
      if (targetLanguages.length > 0) {
        const typeContent = generateTypeDefinitions(Array.from(typeNames), labelsByLanguage);
        files.push({
          path: `${distPath}/types.ts`,
          content: typeContent,
        });
      }

      // Log generation info
      if (files.length > 0) {
        for (const file of files) {
          console.log(`@example/i18n-generator | generate: ${file.path}`);
        }
      }

      return { files };
    },
  };
}

/**
 * Generate TypeScript type definitions for the labels
 */
function generateTypeDefinitions(
  typeNames: string[],
  labelsByLanguage: Record<string, Record<string, Record<string, string>>>,
): string {
  const lines: string[] = [
    "/**",
    " * Auto-generated i18n label types",
    " * DO NOT EDIT - This file is generated by @example/i18n-generator",
    " */",
    "",
  ];

  // Generate field label interfaces for each type
  for (const typeName of typeNames) {
    const languages = Object.keys(labelsByLanguage);
    const langWithType = languages.find((lang) => labelsByLanguage[lang]?.[typeName]);
    const fields = langWithType
      ? Object.keys(labelsByLanguage[langWithType]?.[typeName] ?? {}).filter((f) => f !== "_type")
      : [];
    const hasTypeLabel = languages.some(
      (lang) => labelsByLanguage[lang]?.[typeName]?._type !== undefined,
    );

    lines.push(`export interface ${typeName}Labels {`);
    if (hasTypeLabel) {
      lines.push(`  _type: string;`);
    }
    for (const field of fields) {
      lines.push(`  ${field}: string;`);
    }
    lines.push(`}`);
    lines.push("");
  }

  // Generate Labels type
  lines.push("export interface Labels {");
  for (const typeName of typeNames) {
    lines.push(`  ${typeName}: ${typeName}Labels;`);
  }
  lines.push("}");
  lines.push("");

  // Generate supported languages type
  const languages = Object.keys(labelsByLanguage);
  lines.push(`export type SupportedLanguage = ${languages.map((l) => `"${l}"`).join(" | ")};`);
  lines.push("");

  return lines.join("\n");
}
