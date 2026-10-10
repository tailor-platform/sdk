import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { definePlugin } from "@ts-safeql/plugin-utils";
import postgres from "postgres";

export default definePlugin<{ ddl: string }>({
  name: "tailor-pglite",
  package: fileURLToPath(import.meta.url),
  setup({ ddl }) {
    return {
      createConnection: {
        cacheKey: createHash("sha256").update(ddl).digest("hex"),
        async handler() {
          const pglite = await PGlite.create();
          await pglite.exec(ddl);
          const server = new PGLiteSocketServer({ db: pglite, host: "127.0.0.1", port: 0 });
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
