import { describe, expect, test } from "vitest";
import { brandValue } from "#/utils/brand";
import { parseConfigExport } from "./config-export";

const corpAuth = { name: "corp-auth", machineUsers: { "db-seeder": {} } };
const corpIdp = { name: "corp-idp", clients: ["web"] };
const partnerIdp = { name: "partner-idp", clients: ["web"] };

const workspace = (value: object) => brandValue({ ...value }, "workspace-config");
const app = (value: object) => brandValue({ ...value }, "app-config");

function issuesOf(value: unknown) {
  const result = parseConfigExport(value);
  if (result.success) throw new Error("expected the config to be rejected");
  return result.error.issues.map(({ path, message }) => ({ path, message }));
}

describe("parseConfigExport", () => {
  test("parses an unbranded default export as a defineConfig config", () => {
    const result = parseConfigExport({ name: "my-app" });

    expect(result).toEqual({ success: true, data: { kind: "config", config: { name: "my-app" } } });
  });

  test("returns the workspace representation of a defineWorkspace config", () => {
    const result = parseConfigExport(
      workspace({
        env: { APP_ENV: "DEV", CHECKOUT_URL: "https://example.com/checkout" },
        maintenanceMode: "deploy",
        db: {
          "customer-db": { files: ["./db/customer/**/*.ts"] },
          "ledger-db": { files: ["./db/ledger/**/*.ts"] },
        },
        resolver: {
          "shop-api": {
            files: ["./apps/shop/resolvers/**/*.ts"],
            env: { CHECKOUT_URL: "https://shop.example.com/checkout" },
          },
        },
        executor: { files: ["./executors/**/*.ts"], env: { APP_ENV: "EXECUTOR" } },
        auth: { "corp-auth": { ...corpAuth, env: { APP_ENV: "AUTH" } } },
        idp: { "corp-idp": corpIdp, "partner-idp": partnerIdp },
        apps: {
          shop: {
            db: ["customer-db"],
            resolver: ["shop-api"],
            auth: "corp-auth",
            idp: ["corp-idp"],
            cors: ["https://shop.example.com"],
          },
          backoffice: { db: ["customer-db"], allowedIpAddresses: ["10.0.0.0/8"] },
        },
      }),
    );

    expect(result).toEqual({
      success: true,
      data: {
        kind: "workspace",
        definedBy: "defineWorkspace",
        workspace: {
          env: { APP_ENV: "DEV", CHECKOUT_URL: "https://example.com/checkout" },
          maintenanceMode: "deploy",
          db: {
            "customer-db": { files: ["./db/customer/**/*.ts"] },
            "ledger-db": { files: ["./db/ledger/**/*.ts"] },
          },
          resolver: { "shop-api": { files: ["./apps/shop/resolvers/**/*.ts"] } },
          executor: { files: ["./executors/**/*.ts"] },
          auth: { "corp-auth": corpAuth },
          idp: { "corp-idp": corpIdp, "partner-idp": partnerIdp },
          envOverrides: {
            resolver: { "shop-api": { CHECKOUT_URL: "https://shop.example.com/checkout" } },
            executor: { APP_ENV: "EXECUTOR" },
            auth: { "corp-auth": { APP_ENV: "AUTH" } },
          },
          apps: {
            shop: {
              db: ["customer-db"],
              resolver: ["shop-api"],
              auth: "corp-auth",
              idp: "corp-idp",
              cors: ["https://shop.example.com"],
            },
            backoffice: { db: ["customer-db"], resolver: [], allowedIpAddresses: ["10.0.0.0/8"] },
          },
        },
      },
    });
  });

  test("converts a defineApp config into the same representation as one app in defineWorkspace", () => {
    const shared = {
      env: { APP_ENV: "DEV" },
      maintenanceMode: "migration",
      defaultDateRepresentation: "temporal",
      db: { "customer-db": { files: ["./db/**/*.ts"] } },
      resolver: { "shop-api": { files: ["./resolvers/**/*.ts"] } },
      executor: { files: ["./executors/**/*.ts"] },
      secrets: { vault: { KEY: "value" } },
    };
    const application = {
      cors: ["https://shop.example.com"],
      allowedIpAddresses: ["10.0.0.0/8"],
      disableIntrospection: true,
      metadata: { framework: "v1-2-3" },
    };

    const fromApp = parseConfigExport(
      app({ ...shared, ...application, name: "shop", auth: corpAuth, idp: corpIdp }),
    );
    const fromWorkspace = parseConfigExport(
      workspace({
        ...shared,
        auth: { "corp-auth": corpAuth },
        idp: { "corp-idp": corpIdp },
        apps: {
          shop: {
            ...application,
            db: ["customer-db"],
            resolver: ["shop-api"],
            auth: "corp-auth",
            idp: ["corp-idp"],
          },
        },
      }),
    );

    if (!fromApp.success || !fromWorkspace.success)
      throw new Error("expected both configs to parse");
    expect(fromApp.data).toMatchObject({ kind: "workspace", definedBy: "defineApp" });
    expect(fromWorkspace.data).toMatchObject({ kind: "workspace", definedBy: "defineWorkspace" });
    const workspaceOf = (data: typeof fromApp.data) =>
      data.kind === "workspace" ? data.workspace : undefined;
    expect(workspaceOf(fromApp.data)).toStrictEqual(workspaceOf(fromWorkspace.data));
  });

  test.each([
    {
      name: "a name an app lists that the workspace does not declare",
      value: workspace({
        db: { "customer-db": { files: [] } },
        resolver: { "shop-api": { files: [] } },
        auth: { "corp-auth": corpAuth },
        idp: { "corp-idp": corpIdp },
        apps: { shop: { db: ["typo"], resolver: ["typo"], auth: "typo", idp: ["typo"] } },
      }),
      issues: [
        {
          path: ["apps", "shop", "db", 0],
          message: `'apps.shop.db' lists "typo", which is not a key of 'db'.`,
        },
        {
          path: ["apps", "shop", "resolver", 0],
          message: `'apps.shop.resolver' lists "typo", which is not a key of 'resolver'.`,
        },
        {
          path: ["apps", "shop", "auth"],
          message: `'apps.shop.auth' is "typo", which is not a key of 'auth'.`,
        },
        {
          path: ["apps", "shop", "idp", 0],
          message: `'apps.shop.idp' lists "typo", which is not a key of 'idp'.`,
        },
      ],
    },
    {
      name: "an app that lists no service",
      value: workspace({
        db: { "customer-db": { files: [] } },
        apps: { shop: { db: ["customer-db"] }, landing: { cors: ["https://example.com"] } },
      }),
      issues: [
        {
          path: ["apps", "landing"],
          message:
            "'apps.landing' lists no db, resolver, idp, or auth, so it has no GraphQL API to deploy.",
        },
      ],
    },
    {
      name: "more than one IdP in an app",
      value: workspace({
        idp: { "corp-idp": corpIdp, "partner-idp": partnerIdp },
        apps: { shop: { idp: ["corp-idp", "partner-idp"] } },
      }),
      issues: [
        {
          path: ["apps", "shop", "idp"],
          message:
            "An application can expose at most one IdP. Call idp.Client({ namespace }) from function code to use the others.",
        },
      ],
    },
    {
      name: "env overrides for keys the root env does not declare",
      value: workspace({
        env: { APP_ENV: "DEV" },
        resolver: { "shop-api": { files: [], env: { OTHER: "x" } } },
        executor: { files: [], env: { OTHER: "x" } },
        workflow: { files: [], env: { OTHER: "x" } },
        auth: { "corp-auth": { ...corpAuth, env: { OTHER: "x" } } },
        apps: {},
      }),
      issues: ["resolver.shop-api", "executor", "workflow", "auth.corp-auth"].map((owner) => ({
        path: [...owner.split("."), "env", "OTHER"],
        message: `'${owner}.env' overrides "OTHER", which the root 'env' does not declare.`,
      })),
    },
    {
      name: "an env override with no root env",
      value: workspace({ executor: { files: [], env: { OTHER: "x" } }, apps: {} }),
      issues: [
        {
          path: ["executor", "env", "OTHER"],
          message: `'executor.env' overrides "OTHER", which the root 'env' does not declare.`,
        },
      ],
    },
    {
      name: "external services in defineWorkspace",
      value: workspace({
        db: { "shared-db": { external: true } },
        resolver: { "shared-api": { external: true } },
        auth: { "corp-auth": { name: "corp-auth", external: true } },
        idp: { "corp-idp": { name: "corp-idp", external: true } },
        apps: {},
      }),
      issues: ["db.shared-db", "resolver.shared-api", "auth.corp-auth", "idp.corp-idp"].map(
        (owner) => ({
          path: [...owner.split("."), "external"],
          message:
            "'external' is only accepted by defineConfig(). Declare the service in this config instead.",
        }),
      ),
    },
    {
      name: "an auth or IdP keyed by a name other than its own",
      value: workspace({
        auth: { "other-auth": corpAuth },
        idp: { "other-idp": corpIdp },
        apps: {},
      }),
      issues: [
        {
          path: ["auth", "other-auth", "name"],
          message: `'auth.other-auth' holds the auth named "corp-auth". Key it by its name.`,
        },
        {
          path: ["idp", "other-idp", "name"],
          message: `'idp.other-idp' holds the IdP named "corp-idp". Key it by its name.`,
        },
      ],
    },
    {
      name: "settings that belong to the workspace root in an app",
      value: workspace({
        db: { "customer-db": { files: [] } },
        apps: {
          shop: {
            db: ["customer-db"],
            env: {},
            maintenanceMode: "deploy",
            defaultDateRepresentation: "date",
          },
        },
      }),
      issues: [
        {
          path: ["apps", "shop"],
          message: 'Unrecognized keys: "env", "maintenanceMode", "defaultDateRepresentation"',
        },
      ],
    },
    {
      name: "id, a deprecated top-level option, and external services in defineApp",
      value: app({
        id: "c98794dd-9bf1-480f-a5c9-bf92b3679d42",
        name: "shop",
        logLevel: "INFO",
        db: { "shared-db": { external: true } },
        auth: { name: "corp-auth", external: true },
      }),
      issues: [
        { path: [], message: 'Unrecognized keys: "id", "logLevel"' },
        {
          path: ["db", "shared-db", "external"],
          message:
            "'external' is only accepted by defineConfig(). Declare the service in this config instead.",
        },
        {
          path: ["auth", "external"],
          message:
            "'external' is only accepted by defineConfig(). Declare the service in this config instead.",
        },
      ],
    },
    {
      name: "an IdP array and an auth without a name in defineApp",
      value: app({ name: "shop", auth: {}, idp: [corpIdp] }),
      issues: [
        { path: ["auth"], message: "'auth' must be an auth service defined with defineAuth()." },
        { path: ["idp"], message: "'idp' must be a single IdP defined with defineIdp()." },
      ],
    },
    {
      name: "a db that is not keyed by namespace in defineApp",
      value: app({ name: "shop", db: "./db/**/*.ts" }),
      issues: [{ path: ["db"], message: "Invalid input: expected record, received string" }],
    },
    {
      name: "env overrides in defineApp other than the auth's",
      value: app({
        name: "shop",
        env: { APP_ENV: "DEV" },
        resolver: { "shop-api": { files: [], env: { APP_ENV: "API" } } },
        executor: { files: [], env: { APP_ENV: "EXECUTOR" } },
        workflow: { files: [], env: { APP_ENV: "WORKFLOW" } },
        auth: { ...corpAuth, env: { OTHER: "x" } },
      }),
      issues: [
        ...["resolver.shop-api", "executor", "workflow"].map((owner) => ({
          path: [...owner.split("."), "env"],
          message: `'${owner}.env' is only accepted by defineWorkspace().`,
        })),
        {
          path: ["auth", "env", "OTHER"],
          message: `'auth.env' overrides "OTHER", which the root 'env' does not declare.`,
        },
      ],
    },
  ])("rejects $name", ({ value, issues }) => {
    expect(issuesOf(value)).toEqual(issues);
  });
});
