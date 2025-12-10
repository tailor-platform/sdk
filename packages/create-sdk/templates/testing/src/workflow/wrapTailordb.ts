import { createWorkflowJob, createWorkflow } from "@tailor-platform/sdk";
import type { Selectable } from "kysely";
import { getDB, type DB, type Namespace } from "../generated/db";

type User = Selectable<Namespace["main-db"]["User"]>;

export interface DbOperations {
  getUser: (email: string) => Promise<User | undefined>;
  createUser: (input: {
    name: string;
    email: string;
    age: number;
  }) => Promise<User>;
  updateUser: (user: User) => Promise<void>;
}

function createDbOperations(db: DB<"main-db">): DbOperations {
  return {
    getUser: async (email: string) => {
      return await db
        .selectFrom("User")
        .where("email", "=", email)
        .selectAll()
        .executeTakeFirst();
    },
    createUser: async (input: { name: string; email: string; age: number }) => {
      return await db
        .insertInto("User")
        .values(input)
        .returning(["id", "name", "email", "age", "createdAt", "updatedAt"])
        .executeTakeFirstOrThrow();
    },
    updateUser: async (user: User) => {
      await db
        .updateTable("User")
        .set({ name: user.name, age: user.age })
        .where("email", "=", user.email)
        .execute();
    },
  };
}

export async function incrementUserAge(
  input: { name: string; email: string; age: number },
  dbOperations: DbOperations,
) {
  let user = await dbOperations.getUser(input.email);
  if (!user) {
    user = await dbOperations.createUser(input);
  }

  const oldAge = user.age;
  const newAge = user.age + 1;

  await dbOperations.updateUser({ ...user, age: newAge });

  return { oldAge, newAge };
}

export const incrementAge = createWorkflowJob({
  name: "increment-age",
  body: async (input: { name: string; email: string; age: number }) => {
    const db = getDB("main-db");
    const dbOperations = createDbOperations(db);
    return await incrementUserAge(input, dbOperations);
  },
});

export default createWorkflow({
  name: "user-age-workflow",
  mainJob: incrementAge,
});
