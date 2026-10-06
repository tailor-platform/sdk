import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { definePlugin } from "@ts-safeql/plugin-utils";
import postgres from "postgres";

export default definePlugin({
  name: "pglite-ddl",
  package: fileURLToPath(import.meta.url),
  setup(config) {
    return {
      createConnection: {
        get cacheKey() {
          const ddl = readFileSync(config.ddlPath, "utf8");
          return `${config.ddlPath}:${createHash("sha256").update(ddl).digest("hex")}`;
        },
        async handler() {
          const pg = await PGlite.create();
          await pg.exec(readFileSync(config.ddlPath, "utf8"));
          const server = new PGLiteSocketServer({ db: pg, host: "127.0.0.1", port: 0 });
          await server.start();
          const port = Number(server.getServerConn().split(":").pop());
          return postgres({
            host: "127.0.0.1",
            port,
            database: "postgres",
            username: "postgres",
            max: 1,
          });
        },
      },
    };
  },
});
