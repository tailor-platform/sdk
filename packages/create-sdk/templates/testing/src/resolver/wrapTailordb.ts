import { createResolver, t } from "@tailor-platform/sdk";
import { Selectable } from "kysely";
import { getDB, type DB, type Namespace } from "../generated/db";

export interface DbOperations {
  transaction: <T>(fn: (ops: DbOperations) => Promise<T>) => Promise<T>;

  getUser: (email: string, forUpdate: boolean) => Promise<Selectable<Namespace["main-db"]["User"]>>;
  updateUser: (user: Selectable<Namespace["main-db"]["User"]>) => Promise<void>;
}

function createDbOperations(db: DB<"main-db">): DbOperations {
  return {
    transaction: async <T>(fn: (ops: DbOperations) => Promise<T>): Promise<T> => {
      return await db.transaction().execute(async (trx) => {
        const dbOperations = createDbOperations(trx);
        return await fn(dbOperations);
      });
    },

    getUser: async (email: string, forUpdate: boolean) => {
      let query = db.selectFrom("User").where("email", "=", email).selectAll();
      if (forUpdate) {
        query = query.forUpdate();
      }
      return await query.executeTakeFirstOrThrow();
    },
    updateUser: async (user: Selectable<Namespace["main-db"]["User"]>) => {
      await db
        .updateTable("User")
        .set({ name: user.name, age: user.age })
        .where("email", "=", user.email)
        .execute();
    },
  };
}

export async function decrementUserAge(email: string, dbOperations: DbOperations) {
  return await dbOperations.transaction(async (ops) => {
    // Select user
    const user = await ops.getUser(email, true);

    // Decrease age by 1
    const oldAge = user.age;
    const newAge = user.age - 1;

    // Update user
    await ops.updateUser({ ...user, age: newAge });

    // Return old and new age
    return { oldAge, newAge };
  });
}

export default createResolver({
  name: "decrementUserAge",
  operation: "mutation",
  input: {
    email: t.string(),
  },
  body: async (context) => {
    // Initialize database client
    const db = getDB("main-db");
    const dbOperations = createDbOperations(db);

    return await decrementUserAge(context.input.email, dbOperations);
  },
  output: t.object({
    oldAge: t.int(),
    newAge: t.int(),
  }),
});
