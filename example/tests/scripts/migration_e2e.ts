import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { create } from "@bufbuild/protobuf";
import {
  bundleMigrationScript,
  bundleSeedScript,
  executeScript,
  initOperatorClient,
  loadAccessToken,
  loadWorkspaceId,
  show,
} from "@tailor-platform/sdk/cli";
import { AuthInvokerSchema } from "@tailor-platform/tailor-proto/auth_resource_pb";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const exampleDir = path.resolve(scriptDir, "..", "..");
const fixtureRoot = path.resolve(exampleDir, "tests", "migration-fixtures");
const appDir = path.resolve(fixtureRoot, "app");
const stepsDir = path.resolve(fixtureRoot, "steps");
const configPath = path.resolve(appDir, "tailor.config.ts");
const migrationsDir = path.resolve(appDir, "migrations");
const tailordbDir = path.resolve(appDir, "tailordb");
const templateMigrationsDir = path.resolve(fixtureRoot, "templates");

const namespace = "migrationdb";
const machineUserName = "manager-machine-user";

const tailorSdkBin = path.resolve(
  exampleDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tailor-sdk.cmd" : "tailor-sdk",
);

const runTailorSdk = (args: string[]) => {
  execFileSync(tailorSdkBin, args, {
    cwd: appDir,
    env: {
      ...process.env,
    },
    stdio: "inherit",
  });
};

const runDeploy = () => {
  runTailorSdk(["deploy", "-c", configPath, "--yes"]);
};

const runMigrateGenerate = () => {
  runTailorSdk(["tailordb", "migration", "generate", "-c", configPath, "--yes"]);
};

const resetMigrations = () => {
  fs.rmSync(migrationsDir, { recursive: true, force: true });
  fs.mkdirSync(migrationsDir, { recursive: true });
};

const syncSchemaStep = (stepId: string) => {
  const sourceDir = path.resolve(stepsDir, stepId, "tailordb");
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Schema step not found: ${stepId}`);
  }
  fs.rmSync(tailordbDir, { recursive: true, force: true });
  fs.mkdirSync(tailordbDir, { recursive: true });
  fs.cpSync(sourceDir, tailordbDir, { recursive: true });
};

const ensureInitialSnapshot = () => {
  const schemaPath = path.resolve(migrationsDir, "0000", "schema.json");
  if (!fs.existsSync(schemaPath)) {
    throw new Error("Initial schema snapshot (0000) not generated");
  }
};

const ensureMigrationCreated = (stepId: string) => {
  const diffPath = path.resolve(migrationsDir, stepId, "diff.json");
  if (!fs.existsSync(diffPath)) {
    throw new Error(`Migration diff not generated: ${stepId}`);
  }
};

const copyMigrationScript = (stepId: string) => {
  const sourcePath = path.resolve(templateMigrationsDir, stepId, "migrate.ts");
  const targetPath = path.resolve(migrationsDir, stepId, "migrate.ts");
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Migration script template missing: ${stepId}`);
  }
  fs.copyFileSync(sourcePath, targetPath);
};

const getType = (types: { name?: string }[], name: string) => {
  const type = types.find((t) => t.name === name);
  if (!type) {
    throw new Error(`Type not found: ${name}`);
  }
  return type as { schema?: Record<string, unknown> } & { name: string };
};

const getField = (
  type: { schema?: Record<string, unknown> } & { name: string },
  fieldName: string,
) => {
  const schema = type.schema as { fields?: Record<string, Record<string, unknown>> } | undefined;
  const field = schema?.fields?.[fieldName];
  if (!field) {
    throw new Error(`Field not found: ${type.name}.${fieldName}`);
  }
  return field;
};

const normalizeEnumValues = (values: unknown): string[] => {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      if (value && typeof value === "object" && "value" in value) {
        return String((value as { value: unknown }).value);
      }
      return "";
    })
    .filter(Boolean);
};

const assertSchemaAfter0004 = (types: { name?: string }[]) => {
  const user = getType(types, "User");
  getField(user, "status");
  getField(user, "department");
  const roleField = getField(user, "role");
  const allowedValues = normalizeEnumValues(roleField.allowedValues);
  if (!allowedValues.includes("UNKNOWN")) {
    throw new Error("User.role enum should include UNKNOWN after 0004");
  }
};

const assertSchemaAfter0005 = (types: { name?: string }[]) => {
  const user = getType(types, "User");
  const roleField = getField(user, "role");
  const allowedValues = normalizeEnumValues(roleField.allowedValues);
  if (allowedValues.includes("UNKNOWN")) {
    throw new Error("User.role enum should not include UNKNOWN after 0005");
  }

  const supplier = getType(types, "Supplier");
  const nameField = getField(supplier, "name");
  const countryField = getField(supplier, "country");
  if (nameField.required !== true || countryField.required !== true) {
    throw new Error("Supplier.name and Supplier.country should be required after 0005");
  }
};

const assertSchemaAfterFinal = (types: { name?: string }[]) => {
  const user = getType(types, "User");
  const userSchema = user.schema as {
    fields?: Record<string, Record<string, unknown>>;
    indexes?: Record<string, unknown>;
    files?: Record<string, unknown>;
  };
  const nameField = getField(user, "name");
  if (nameField.unique === true) {
    throw new Error("User.name should not be unique after 0007");
  }
  if (!userSchema?.indexes?.idx_name_department || !userSchema?.indexes?.user_status_created_idx) {
    throw new Error("User indexes should include idx_name_department and user_status_created_idx");
  }
  if (!userSchema?.files?.avatar) {
    throw new Error("User files should include avatar after 0007");
  }

  const salesOrder = getType(types, "SalesOrder");
  const salesSchema = salesOrder.schema as {
    indexes?: Record<string, unknown>;
    files?: Record<string, unknown>;
  };
  if (!salesSchema?.indexes?.idx_status_createdAt || !salesSchema?.indexes?.idx_customerID_status) {
    throw new Error(
      "SalesOrder indexes should include idx_status_createdAt and idx_customerID_status",
    );
  }
  if (!salesSchema?.files?.receipt || !salesSchema?.files?.form) {
    throw new Error("SalesOrder files should include receipt and form");
  }
};

const baseUsers = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Duplicate",
    email: "duplicate-1@example.com",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Duplicate",
    email: "duplicate-2@example.com",
  },
  {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Unique",
    email: "unique@example.com",
  },
];

const baseSuppliers = [
  {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    name: null,
    country: null,
    phone: "000-0000",
    state: "Alabama",
    city: "Test City",
  },
];

const unknownRoleUser = [
  {
    id: "44444444-4444-4444-4444-444444444444",
    name: "Unknown Role",
    email: "unknown-role@example.com",
    role: "UNKNOWN",
  },
];

resetMigrations();

console.log("Generating baseline (0000)...");
syncSchemaStep("0000");
runMigrateGenerate();
ensureInitialSnapshot();

console.log("Applying base schema (0000)...");
runDeploy();

const accessToken = await loadAccessToken();
const workspaceId = await loadWorkspaceId();
const client = await initOperatorClient(accessToken);
const appInfo = await show({ configPath });
const authNamespace = appInfo.auth;

const invoker = create(AuthInvokerSchema, {
  namespace: authNamespace,
  machineUserName,
});

let scriptCounter = 9000;

const runAssertionScript = async (relativePath: string, label: string) => {
  const scriptPath = path.resolve(exampleDir, "tests/scripts/migration", relativePath);
  const bundled = await bundleMigrationScript(scriptPath, namespace, scriptCounter++);
  const result = await executeScript({
    client,
    workspaceId,
    name: `${label}.js`,
    code: bundled.bundledCode,
    invoker,
  });
  if (!result.success) {
    throw new Error(`${label} failed: ${result.error ?? "unknown error"}`);
  }
};

const seedData = async (
  data: Record<string, Record<string, unknown>[]>,
  order: string[],
  label: string,
) => {
  const bundled = await bundleSeedScript(namespace, order);
  const result = await executeScript({
    client,
    workspaceId,
    name: `${label}.js`,
    code: bundled.bundledCode,
    arg: { data, order } as unknown as JsonValue,
    invoker,
  });
  if (!result.success) {
    throw new Error(`${label} failed: ${result.error ?? "unknown error"}`);
  }
};

const fetchTypes = async () => {
  const { tailordbTypes } = await client.listTailorDBTypes({
    workspaceId,
    namespaceName: namespace,
  });
  return tailordbTypes ?? [];
};

console.log("Seeding base data...");
await seedData(
  {
    User: baseUsers,
    Supplier: baseSuppliers,
  },
  ["User", "Supplier"],
  "seed-base",
);

for (const stepId of ["0001", "0002"]) {
  console.log(`Generating migration ${stepId}...`);
  syncSchemaStep(stepId);
  runMigrateGenerate();
  ensureMigrationCreated(stepId);

  console.log(`Applying migration ${stepId}...`);
  runDeploy();
}

console.log("Generating migration 0003...");
syncSchemaStep("0003");
runMigrateGenerate();
ensureMigrationCreated("0003");
copyMigrationScript("0003");

console.log("Applying migration 0003...");
runDeploy();

console.log("Generating migration 0004...");
syncSchemaStep("0004");
runMigrateGenerate();
ensureMigrationCreated("0004");

console.log("Applying migration 0004...");
runDeploy();

await runAssertionScript("assert_roles_populated.ts", "assert-roles-populated");
assertSchemaAfter0004(await fetchTypes());

console.log("Seeding UNKNOWN role user...");
await seedData({ User: unknownRoleUser }, ["User"], "seed-unknown-role");

console.log("Generating migration 0005...");
syncSchemaStep("0005");
runMigrateGenerate();
ensureMigrationCreated("0005");
copyMigrationScript("0005");

console.log("Applying migration 0005...");
runDeploy();

await runAssertionScript("assert_after_0005.ts", "assert-after-0005");
assertSchemaAfter0005(await fetchTypes());

console.log("Generating migration 0006...");
syncSchemaStep("0006");
runMigrateGenerate();
ensureMigrationCreated("0006");
copyMigrationScript("0006");

console.log("Applying migration 0006...");
runDeploy();

await runAssertionScript("assert_no_duplicate_names.ts", "assert-no-duplicates");

console.log("Generating migration 0007...");
syncSchemaStep("0007");
runMigrateGenerate();
ensureMigrationCreated("0007");

console.log("Applying migration 0007...");
runDeploy();

assertSchemaAfterFinal(await fetchTypes());

console.log("Migration e2e completed successfully.");
