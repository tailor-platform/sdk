import type { Plugin, TailorDBNamespacePluginOutput } from "@tailor-platform/sdk";

interface NamespaceHooks {
  onTailorDBNamespaceLoaded?(context: { namespace: string }): TailorDBNamespacePluginOutput;
}

export class AuditLogPlugin implements Plugin, NamespaceHooks {
  readonly id = "@example/audit-log";
  readonly description = "Adds an audit log table";
  readonly importPath = "@example/audit-log";

  onTailorDBNamespaceLoaded(): TailorDBNamespacePluginOutput {
    return {};
  }
}
