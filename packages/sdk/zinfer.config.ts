import { defineConfig } from "zinfer";

export default defineConfig({
  project: "./tsconfig.json",
  include: ["src/parser/**/schema.ts"],
  outDir: "./src/types",
  outPattern: "[dir].generated[ext]",
  suffix: "Schema",
  inputSuffix: "Input",
  outputSuffix: "",
  mergeSame: true,
  withDescriptions: true,
  generateTests: false,
  map: {
    AppConfigSchema: "AppConfigParsed",
    TailorDBTypeSettingsSchema: "TailorDBTypeParsedSettings",
    TailorDBTypeSchema: "TailorDBTypeRaw",
    SCIMSchema: "SCIMConfig",
    GqlOperationsSchema: "GqlOperations",
    IdPGqlOperationsSchema: "IdPGqlOperations",
    QueryTypeSchema: "QueryType",
    OAuth2ClientGrantTypeSchema: "OAuth2ClientGrantType",
    SCIMAttributeTypeSchema: "SCIMAttributeType",
  },
});
