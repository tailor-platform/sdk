import { createWorkflowJob, createWorkflow } from "@tailor-platform/sdk";
import type { Selectable } from "kysely";
import { getDB, type DB, type Namespace } from "../generated/db";

export interface DbOperations {
  getUser: (email: string) => Promise<Selectable<Namespace["main-db"]["User"]>>;
  updateUser: (user: Selectable<Namespace["main-db"]["User"]>) => Promise<void>;
}

function createDbOperations(db: DB<"main-db">): DbOperations {
  return {
    getUser: async (email: string) => {
      return await db
        .selectFrom("User")
        .where("email", "=", email)
        .selectAll()
        .executeTakeFirstOrThrow();
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

export async function incrementUserAge(
  email: string,
  dbOperations: DbOperations,
) {
  const user = await dbOperations.getUser(email);
  const oldAge = user.age;
  const newAge = user.age + 1;

  await dbOperations.updateUser({ ...user, age: newAge });

  return { oldAge, newAge };
}

export const incrementAge = createWorkflowJob({
  name: "increment-age",
  body: async (input: { email: string }) => {
    const db = getDB("main-db");
    const dbOperations = createDbOperations(db);
    return await incrementUserAge(input.email, dbOperations);
  },
});

export default createWorkflow({
  name: "user-age-workflow",
  mainJob: incrementAge,
});
