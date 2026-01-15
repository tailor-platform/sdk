import { writeTblsSchemaToFile } from "./export";
import { runLiamBuild } from "./liam";
import type { TailorDBSchemaOptions } from "./export";

/**
 * Export TailorDB schema and build ERD artifacts via liam.
 * @param {TailorDBSchemaOptions & { outputPath: string; erdDir: string }} options - Build options.
 * @returns {Promise<{ schemaPath: string; erdDir: string }>} Schema path and ERD directory.
 */
export async function prepareErdBuild(
  options: TailorDBSchemaOptions & { outputPath: string; erdDir: string },
): Promise<{ schemaPath: string; erdDir: string }> {
  await writeTblsSchemaToFile(options);

  await runLiamBuild(options.outputPath, options.erdDir);

  return { schemaPath: options.outputPath, erdDir: options.erdDir };
}
