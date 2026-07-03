import * as fs from "node:fs";
import * as path from "pathe";
import { logger } from "#/cli/shared/logger";
import ml from "#/utils/multiline";
import type { AppConfig } from "#/configure/config/types";

export interface AttributesConfig {
  [key: string]: string;
}

export type AttributeListConfig = readonly string[];

type ScalarTypeName =
  | "DateString"
  | "DateTimeString"
  | "DecimalString"
  | "TimeString"
  | "UUIDString";

const scalarTypeNames: ScalarTypeName[] = [
  "DateString",
  "DateTimeString",
  "DecimalString",
  "TimeString",
  "UUIDString",
];

const knownAttributeListTypes = new Set<string>([
  "boolean",
  "number",
  "string",
  ...scalarTypeNames,
]);

const fieldTypeScriptTypes: Record<string, string> = {
  boolean: "boolean",
  bool: "boolean",
  uuid: "UUIDString",
  date: "DateString",
  datetime: "DateTimeString | Date",
  time: "TimeString",
  decimal: "DecimalString",
  integer: "number",
  float: "number",
  number: "number",
};

interface ExtractedAttributes {
  attributes?: AttributesConfig;
  attributeList?: AttributeListConfig;
  env?: Record<string, string | number | boolean>;
  machineUserNames?: string[];
  idpNames?: string[];
  connectionNames?: string[];
}

type AttributeFieldLike = {
  type?: string;
  metadata?: {
    array?: boolean;
    allowedValues?: Array<{ value: string }>;
  };
};

/**
 * Extract attribute definitions from the app config for user-defined typing.
 * @param config - Application config to inspect
 * @returns Extracted attributes/list and env values
 * @internal
 */
export function extractAttributesFromConfig(config: AppConfig): ExtractedAttributes {
  return collectAttributesFromConfig(config);
}

/**
 * Generate the contents of the user-defined type definition file.
 * @param attributes - Attribute configuration
 * @param attributeList - Attribute list configuration
 * @param env - Environment configuration
 * @param machineUserNames - Registered machine user names (used to narrow `invoker` strings)
 * @param idpNames - Registered IdP names (used to narrow `idpUser*Trigger({ idp })` strings)
 * @param connectionNames - Registered auth connection names (used to narrow `getConnectionToken()` strings)
 * @returns Generated type definition source
 */
export function generateTypeDefinition(
  attributes: AttributesConfig | undefined,
  attributeList: AttributeListConfig | undefined,
  env?: Record<string, string | number | boolean>,
  machineUserNames?: readonly string[],
  idpNames?: readonly string[],
  connectionNames?: readonly string[],
): string {
  const attributeListTypes = attributeList?.map(normalizeAttributeListType);
  const scalarTypeImports = collectScalarTypeImports([
    ...Object.values(attributes ?? {}),
    ...(attributeListTypes ?? []),
  ]);
  const scalarTypeImportSource =
    scalarTypeImports.length > 0
      ? `import type { ${scalarTypeImports.join(", ")} } from "@tailor-platform/sdk";\n\n`
      : "";

  // Generate Attributes interface
  // attributes values are type string representations (e.g., "string", "boolean", "string[]")
  const attributeFields = attributes
    ? Object.entries(attributes)
        .map(([key, value]) => `    ${key}: ${value};`)
        .join("\n")
    : "";

  const attributesBody =
    !attributes || Object.keys(attributes).length === 0
      ? "{}"
      : `{
${attributeFields}
  }`;

  // Generate AttributeList type as a tuple of strings based on the length
  const listType = attributeListTypes ? `[${attributeListTypes.join(", ")}]` : "[]";

  // Use interface with __tuple marker for declaration merging and tuple type support
  const listBody = `{
    __tuple?: ${listType};
  }`;

  // Generate Env interface
  const envFields = env
    ? Object.entries(env)
        .map(([key, value]) => {
          const valueType = typeof value === "string" ? `"${value}"` : String(value);
          return `    ${key}: ${valueType};`;
        })
        .join("\n")
    : "";

  const envBody =
    !env || Object.keys(env).length === 0
      ? "{}"
      : `{
${envFields}
  }`;

  // Generate MachineUserNameRegistry interface.
  // Quote keys only when they aren't valid TypeScript identifiers — matches
  // the formatter (oxfmt) output so subsequent format passes are no-ops.
  const isValidIdentifier = (s: string): boolean => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s);
  const machineUserFields = machineUserNames?.length
    ? machineUserNames
        .map((name) => `    ${isValidIdentifier(name) ? name : JSON.stringify(name)}: true;`)
        .join("\n")
    : "";

  const machineUserBody =
    !machineUserNames || machineUserNames.length === 0
      ? "{}"
      : `{
${machineUserFields}
  }`;

  // Generate IdpNameRegistry interface (same quoting rules as machine users).
  const idpNameFields = idpNames?.length
    ? idpNames
        .map((name) => `    ${isValidIdentifier(name) ? name : JSON.stringify(name)}: true;`)
        .join("\n")
    : "";

  const idpNameBody =
    !idpNames || idpNames.length === 0
      ? "{}"
      : `{
${idpNameFields}
  }`;

  // Generate ConnectionNameRegistry interface (same quoting rules as machine users).
  const connectionNameFields = connectionNames?.length
    ? connectionNames
        .map((name) => `    ${isValidIdentifier(name) ? name : JSON.stringify(name)}: true;`)
        .join("\n")
    : "";

  const connectionNameBody =
    !connectionNames || connectionNames.length === 0
      ? "{}"
      : `{
${connectionNameFields}
  }`;

  return `${scalarTypeImportSource}${ml /* ts */ `
// This file is auto-generated by @tailor-platform/sdk
// Do not edit this file manually
// Regenerated automatically when running 'tailor deploy' or 'tailor generate'

declare module "@tailor-platform/sdk" {
  interface Attributes ${attributesBody}
  interface AttributeList ${listBody}
  interface Env ${envBody}
  interface MachineUserNameRegistry ${machineUserBody}
  interface IdpNameRegistry ${idpNameBody}
  interface ConnectionNameRegistry ${connectionNameBody}
}

export {};

`}`;
}

function collectScalarTypeImports(types: readonly string[]): ScalarTypeName[] {
  return scalarTypeNames.filter((typeName) =>
    types.some((type) => new RegExp(`\\b${typeName}\\b`).test(type)),
  );
}

function normalizeAttributeListType(typeOrKey: string): string {
  return knownAttributeListTypes.has(typeOrKey) ? typeOrKey : "string";
}

function collectAttributesFromConfig(config: AppConfig): ExtractedAttributes {
  // De-duplicate IdP names so duplicates in config don't emit duplicate
  // `IdpNameRegistry` keys (which would be invalid TypeScript).
  const idpNames = config.idp?.length ? [...new Set(config.idp.map((idp) => idp.name))] : undefined;

  const auth = config.auth;
  if (!auth || typeof auth !== "object") {
    return idpNames ? { idpNames } : {};
  }

  // Extract machine user names from auth.machineUsers (available regardless of userProfile vs. machineUserAttributes)
  const machineUsersObj = (auth as { machineUsers?: Record<string, unknown> }).machineUsers;
  const machineUserNames =
    machineUsersObj && typeof machineUsersObj === "object"
      ? Object.keys(machineUsersObj)
      : undefined;

  // Extract connection names from auth.connections (available regardless of userProfile vs. machineUserAttributes)
  const connectionsObj = (auth as { connections?: Record<string, unknown> }).connections;
  const connectionNames =
    connectionsObj && typeof connectionsObj === "object" ? Object.keys(connectionsObj) : undefined;

  const inferAttributeType = (field?: AttributeFieldLike): string => {
    const type = field?.type;
    const metadata = field?.metadata;

    if (!type && !metadata) {
      return "string";
    }

    const typeStr =
      type === "enum" && metadata?.allowedValues
        ? metadata.allowedValues.map((v) => `"${v.value}"`).join(" | ")
        : type
          ? (fieldTypeScriptTypes[type] ?? "string")
          : "string";

    // Add array suffix if needed
    if (metadata?.array) {
      return typeStr.includes("|") ? `(${typeStr})[]` : `${typeStr}[]`;
    }

    return typeStr;
  };

  // Check if auth has userProfile with attributes/attributeList
  if ("userProfile" in auth) {
    const userProfile = (
      auth as {
        userProfile?: {
          type?: {
            fields?: Record<string, AttributeFieldLike>;
          };
          attributes?: Record<string, true>;
          attributeList?: AttributeListConfig;
        };
      }
    ).userProfile;

    const selectedAttributes = userProfile?.attributes;
    const fields = userProfile?.type?.fields;
    const attributeList = userProfile?.attributeList?.map((key) =>
      inferAttributeType(fields?.[key]),
    );

    // Convert attributes to AttributesConfig by inferring types from field metadata
    const attributes: AttributesConfig | undefined = selectedAttributes
      ? Object.keys(selectedAttributes).reduce((acc, key) => {
          acc[key] = inferAttributeType(fields?.[key]);
          return acc;
        }, {} as AttributesConfig)
      : undefined;

    return {
      attributes,
      attributeList,
      machineUserNames,
      idpNames,
      connectionNames,
    };
  }

  if ("machineUserAttributes" in auth) {
    const machineUserAttributes = (
      auth as {
        machineUserAttributes?: Record<string, AttributeFieldLike>;
      }
    ).machineUserAttributes;

    if (!machineUserAttributes) {
      return { machineUserNames, idpNames, connectionNames };
    }

    const attributes = Object.entries(machineUserAttributes).reduce((acc, [key, field]) => {
      acc[key] = inferAttributeType(field);
      return acc;
    }, {} as AttributesConfig);

    return {
      attributes,
      machineUserNames,
      idpNames,
      connectionNames,
    };
  }

  return { machineUserNames, idpNames, connectionNames };
}

/**
 * Resolve the output path for the generated type definition file.
 *
 * When the `TAILOR_DTS_PATH` environment variable is set, the value is
 * used as the output path (resolved relative to cwd when relative).
 * Otherwise, the file is written next to the config file as `tailor.d.ts`.
 * @param configPath - Path to Tailor config file
 * @returns Absolute path to the type definition file
 */
export function resolveTypeDefinitionPath(configPath: string): string {
  const envPath = process.env.TAILOR_DTS_PATH;
  if (envPath) {
    return path.resolve(envPath);
  }
  return path.join(path.dirname(path.resolve(configPath)), "tailor.d.ts");
}

/**
 * Options for generating user type definitions
 */
interface GenerateUserTypesOptions {
  /** Application config */
  config: AppConfig;
  /** Path to Tailor config file */
  configPath: string;
}

/**
 * Generate user type definitions from the app config and write them to disk.
 * @param options - Generation options
 * @returns Promise that resolves when types are generated
 */
export async function generateUserTypes(options: GenerateUserTypesOptions): Promise<void> {
  const { config, configPath } = options;
  try {
    const { attributes, attributeList, machineUserNames, idpNames, connectionNames } =
      extractAttributesFromConfig(config);
    if (!attributes && !attributeList) {
      logger.info("No attributes found in configuration", { mode: "plain" });
    }

    if (attributes) {
      logger.debug(`Extracted Attributes: ${JSON.stringify(attributes)}`);
    }
    if (attributeList) {
      logger.debug(`Extracted AttributeList: ${JSON.stringify(attributeList)}`);
    }
    if (machineUserNames?.length) {
      logger.debug(`Extracted MachineUserNames: ${JSON.stringify(machineUserNames)}`);
    }
    if (idpNames?.length) {
      logger.debug(`Extracted IdpNames: ${JSON.stringify(idpNames)}`);
    }
    if (connectionNames?.length) {
      logger.debug(`Extracted ConnectionNames: ${JSON.stringify(connectionNames)}`);
    }

    const env = config.env;
    if (env) {
      logger.debug(`Extracted Env: ${JSON.stringify(env)}`);
    }

    // Generate type definition
    const typeDefContent = generateTypeDefinition(
      attributes,
      attributeList,
      env,
      machineUserNames,
      idpNames,
      connectionNames,
    );
    const outputPath = resolveTypeDefinitionPath(configPath);

    // Write to file
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, typeDefContent);
    const relativePath = path.relative(process.cwd(), outputPath);
    logger.newline();
    logger.success(`Generated type definitions: ${relativePath}`, {
      mode: "plain",
    });
  } catch (error) {
    logger.error("Error generating types");
    logger.error(String(error));
    // Don't throw - this should not block apply/generate
  }
}
