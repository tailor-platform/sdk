import { writeTblsSchemaToFile } from "./export";
import { runLiamBuild } from "./liam";
import type { TailorDBSchemaOptions } from "./export";

/**
 * Export TailorDB schema and build ERD artifacts via liam.
 * @param {TailorDBSchemaOptions & { outputPath: string; erdDir: string }} options - Build options.
 */
export async function prepareErdBuild(
  options: TailorDBSchemaOptions & { outputPath: string; erdDir: string },
): Promise<void> {
  await writeTblsSchemaToFile(options);

  await runLiamBuild(options.outputPath, options.erdDir);
}
