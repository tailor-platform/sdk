import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { definePlugin } from "@ts-safeql/plugin-utils";
import postgres from "postgres";

export default definePlugin({
  name: "pglite-ddl",
  package: new URL(import.meta.url).pathname,
  setup(config) {
    return {
      createConnection: {
        cacheKey: config.ddlPath,
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
