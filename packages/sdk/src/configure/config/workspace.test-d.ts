import { describe, expectTypeOf, test } from "vitest";
import { defineAuth } from "#/configure/services/auth/index";
import { defineIdp } from "#/configure/services/idp/index";
import { t } from "#/configure/types/type";
import { defineApp, defineWorkspace } from "./workspace";
// oxlint-disable vitest/expect-expect -- Type-only assertions are checked by TypeScript.
import type { AppDefinition, WorkspaceConfig } from "@tailor-platform/sdk";

const corpAuth = defineAuth("corp-auth", {
  machineUserAttributes: { role: t.string() },
  machineUsers: { "db-seeder": { attributes: { role: "seeder" } } },
});
const corpIdp = defineIdp("corp-idp", { clients: ["web"] });
const partnerIdp = defineIdp("partner-idp", { clients: ["web"] });

describe("defineWorkspace", () => {
  test("accepts services owned by the workspace and apps that list them by name", () => {
    defineWorkspace({
      env: { APP_ENV: process.env.APP_ENV ?? "DEV", CHECKOUT_URL: "https://example.com" },
      maintenanceMode: "migration",
      defaultDateRepresentation: "temporal",
      db: {
        "customer-db": { files: ["./db/customer/**/*.ts"] },
        "order-db": { files: ["./db/order/**/*.ts"] },
        "ledger-db": { files: ["./db/ledger/**/*.ts"] },
      },
      resolver: {
        "shop-api": {
          files: ["./apps/shop/resolvers/**/*.ts"],
          env: { CHECKOUT_URL: "https://shop.example.com/checkout" },
        },
        "backoffice-api": { files: ["./apps/backoffice/resolvers/**/*.ts"] },
      },
      executor: { files: ["./executors/**/*.ts"], env: { APP_ENV: "EXECUTOR" } },
      workflow: { files: ["./workflows/**/*.ts"], env: { APP_ENV: "WORKFLOW" } },
      auth: { "corp-auth": corpAuth },
      idp: { "corp-idp": corpIdp, "partner-idp": partnerIdp },
      apps: {
        shop: {
          db: ["customer-db", "order-db"],
          resolver: ["shop-api"],
          auth: "corp-auth",
          idp: ["corp-idp"],
          cors: ["https://shop.example.com"],
        },
        backoffice: {
          db: ["customer-db", "order-db"],
          resolver: ["backoffice-api"],
          auth: "corp-auth",
          allowedIpAddresses: ["10.0.0.0/8"],
        },
      },
    });
  });

  test("rejects an app that lists a name the workspace does not declare", () => {
    defineWorkspace({
      db: { "customer-db": { files: ["./db/**/*.ts"] } },
      resolver: { "shop-api": { files: ["./resolvers/**/*.ts"] } },
      auth: { "corp-auth": corpAuth },
      idp: { "corp-idp": corpIdp },
      apps: {
        shop: {
          // @ts-expect-error - "typo" is not a key of `db`
          db: ["typo"],
          // @ts-expect-error - "typo" is not a key of `resolver`
          resolver: ["typo"],
          // @ts-expect-error - "typo" is not a key of `auth`
          auth: "typo",
          // @ts-expect-error - "typo" is not a key of `idp`
          idp: ["typo"],
        },
      },
    });
  });

  test("rejects more than one IdP in an app", () => {
    defineWorkspace({
      idp: { "corp-idp": corpIdp, "partner-idp": partnerIdp },
      apps: {
        // @ts-expect-error - an app exposes at most one IdP
        shop: { idp: ["corp-idp", "partner-idp"] },
      },
    });
  });

  test("rejects an env override for a key the root env does not declare", () => {
    defineWorkspace({
      env: { APP_ENV: "DEV" },
      resolver: {
        // @ts-expect-error - OTHER is not a key of the root `env`
        "shop-api": { files: ["./resolvers/**/*.ts"], env: { OTHER: "x" } },
      },
      // @ts-expect-error - OTHER is not a key of the root `env`
      executor: { files: ["./executors/**/*.ts"], env: { OTHER: "x" } },
      apps: {},
    });
  });

  test("rejects an env override when the root env is omitted", () => {
    defineWorkspace({
      // @ts-expect-error - there is no root `env` to override
      executor: { files: ["./executors/**/*.ts"], env: { OTHER: "x" } },
      apps: {},
    });
  });

  test("rejects an auth keyed by a name other than its own", () => {
    defineWorkspace({
      // @ts-expect-error - the key must be the auth's name
      auth: { "other-auth": corpAuth },
      apps: {},
    });
  });

  test("rejects settings that belong to the workspace or to defineConfig", () => {
    defineWorkspace({
      env: { APP_ENV: "DEV" },
      apps: {
        shop: {
          // @ts-expect-error - env is written once at the workspace root
          env: { APP_ENV: "SHOP" },
        },
        backoffice: {
          // @ts-expect-error - maintenanceMode is written once at the workspace root
          maintenanceMode: "deploy",
        },
      },
    });
    defineWorkspace({
      // @ts-expect-error - external services are only accepted by defineConfig
      db: { "shared-db": { external: true } },
      apps: {},
    });
    defineWorkspace({
      // @ts-expect-error - the workspace has no application id
      id: "00000000-0000-4000-8000-000000000000",
      apps: {},
    });
  });
});

describe("defineApp", () => {
  test("accepts a defineConfig-style single application without id", () => {
    defineApp({
      name: "shop",
      env: { APP_ENV: "DEV" },
      db: { "customer-db": { files: ["./db/**/*.ts"] } },
      resolver: { "shop-api": { files: ["./resolvers/**/*.ts"] } },
      auth: corpAuth,
      idp: corpIdp,
      cors: ["https://shop.example.com"],
      maintenanceMode: "deploy",
    });
  });

  test("rejects id and external services", () => {
    defineApp({
      name: "shop",
      // @ts-expect-error - defineApp has no application id
      id: "00000000-0000-4000-8000-000000000000",
    });
    defineApp({
      name: "shop",
      // @ts-expect-error - external namespaces are only accepted by defineConfig
      db: { "shared-db": { external: true } },
    });
    defineApp({
      name: "shop",
      // @ts-expect-error - external auth is only accepted by defineConfig
      auth: { name: "corp-auth", external: true },
    });
    defineApp({
      name: "shop",
      // @ts-expect-error - an application exposes a single IdP
      idp: [corpIdp],
    });
  });
});

describe("@tailor-platform/sdk", () => {
  test("exports the config types of defineWorkspace and defineApp", () => {
    expectTypeOf(defineWorkspace({ apps: {} })).toExtend<WorkspaceConfig>();
    expectTypeOf(defineApp({ name: "shop" })).toExtend<AppDefinition>();
  });
});
