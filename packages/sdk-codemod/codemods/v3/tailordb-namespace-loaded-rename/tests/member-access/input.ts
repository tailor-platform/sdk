import { expect, test } from "vitest";
import type { Plugin } from "@tailor-platform/sdk";
import { auditLogPlugin } from "./plugin";

test("generates the audit log table", async () => {
  const plugin: Plugin = auditLogPlugin();
  const output = await plugin.onNamespaceLoaded?.({ pluginConfig: undefined, namespace: "main" });
  const { onNamespaceLoaded } = plugin;
  expect(output?.tables).toBeDefined();
  expect(plugin["onNamespaceLoaded"]).toBe(onNamespaceLoaded);
});
