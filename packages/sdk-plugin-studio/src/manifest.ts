import { z } from "zod";

const RESERVED_IDS = new Set(["api", "plugins", "assets"]);

const idSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "id must be lowercase letters, digits and hyphens")
  .refine((id) => !RESERVED_IDS.has(id), "id is reserved by the shell");

const moduleManifestSchema = z.looseObject({
  id: idSchema,
  title: z.string().min(1),
  kind: z.literal("module"),
  entry: z.string().min(1),
});

export type UiManifest = z.infer<typeof moduleManifestSchema>;

/**
 * Validate a plugin's UI manifest.
 * @param raw - Manifest as declared by the plugin
 * @returns The validated manifest
 */
export function parseUiManifest(raw: unknown): UiManifest {
  if (typeof raw === "object" && raw !== null && "kind" in raw && raw.kind === "process") {
    throw new Error('UI manifest kind "process" is not supported yet; use kind "module".');
  }
  const result = moduleManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      `Invalid UI manifest: ${result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`,
    );
  }
  return result.data;
}
