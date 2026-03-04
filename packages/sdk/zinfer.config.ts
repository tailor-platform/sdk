import { defineConfig } from "zinfer";

export default defineConfig({
  project: "./tsconfig.json",
  include: [
    "src/parser/service/resolver/schema.ts",
    "src/parser/service/executor/schema.ts",
    "src/parser/service/workflow/schema.ts",
    "src/parser/service/auth/schema.ts",
    "src/parser/service/idp/schema.ts",
    "src/parser/service/staticwebsite/schema.ts",
    "src/parser/service/tailordb/schema.ts",
  ],
  outDir: "./src/types",
  outPattern: "[dir][ext]",
  suffix: "Schema",
  inputSuffix: "Input",
  outputSuffix: "",
  mergeSame: true,
  withDescriptions: true,
  generateTests: false,
  map: {
    TailorDBTypeSettingsSchema: "TailorDBTypeParsedSettings",
    TailorDBTypeSchema: "TailorDBTypeRaw",
    SCIMSchema: "SCIMConfig",
  },
});
