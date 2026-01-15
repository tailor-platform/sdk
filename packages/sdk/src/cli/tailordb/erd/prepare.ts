import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../../utils/logger";
import { exportTailorDBSchema } from "./export";
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
  const schema = await exportTailorDBSchema(options);
  const json = JSON.stringify(schema, null, 2);

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, json, "utf8");

  const relativePath = path.relative(process.cwd(), options.outputPath);
  logger.success(`Wrote ERD schema to ${relativePath}`);

  await runLiamBuild(options.outputPath, options.erdDir);

  return { schemaPath: options.outputPath, erdDir: options.erdDir };
}
