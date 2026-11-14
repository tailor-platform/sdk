import { defineConfig } from "@tailor-platform/sdk";
import config, { auth } from "../tailor.config";

export { auth };

function withFilesFromExampleDir<Service extends { files: readonly string[] }>(service: Service) {
  // Auth hooks bundle this module for the Platform runtime, which has no node:path.
  return { ...service, files: service.files.map((file) => `../${file}`) };
}

export default defineConfig({
  ...config,
  db: Object.fromEntries(
    Object.entries(config.db).map(([namespace, db]) => [namespace, withFilesFromExampleDir(db)]),
  ),
  resolver: Object.fromEntries(
    Object.entries(config.resolver).map(([namespace, resolver]) => [
      namespace,
      withFilesFromExampleDir(resolver),
    ]),
  ),
  executor: withFilesFromExampleDir(config.executor),
  workflow: withFilesFromExampleDir(config.workflow),
  httpAdapter: withFilesFromExampleDir(config.httpAdapter),
});
