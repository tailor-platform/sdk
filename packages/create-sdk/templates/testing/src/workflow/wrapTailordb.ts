import { createWorkflowJob, createWorkflow } from "@tailor-platform/sdk";
import type { Selectable } from "kysely";
import { getDB, type DB, type Namespace } from "../generated/db";

type User = Selectable<Namespace["main-db"]["User"]>;

export interface UserProfile {
  name: string;
  email: string;
  age: number;
}

export interface SyncResult {
  created: boolean;
  profile: UserProfile;
}

export interface DbOperations {
  getUser: (email: string) => Promise<User | undefined>;
  createUser: (input: UserProfile) => Promise<User>;
  updateUser: (
    email: string,
    input: Omit<UserProfile, "email">,
  ) => Promise<void>;
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
    createUser: async (input: UserProfile) => {
      return await db
        .insertInto("User")
        .values(input)
        .returning(["id", "name", "email", "age", "createdAt", "updatedAt"])
        .executeTakeFirstOrThrow();
    },
    updateUser: async (email: string, input: Omit<UserProfile, "email">) => {
      await db
        .updateTable("User")
        .set({ name: input.name, age: input.age })
        .where("email", "=", email)
        .execute();
    },
  };
}

export async function syncUserProfile(
  input: UserProfile,
  dbOperations: DbOperations,
): Promise<SyncResult> {
  const existingUser = await dbOperations.getUser(input.email);

  if (existingUser) {
    await dbOperations.updateUser(input.email, {
      name: input.name,
      age: input.age,
    });
    return {
      created: false,
      profile: { name: input.name, email: input.email, age: input.age },
    };
  }

  const newUser = await dbOperations.createUser(input);
  return {
    created: true,
    profile: { name: newUser.name, email: newUser.email, age: newUser.age },
  };
}

export const syncProfile = createWorkflowJob({
  name: "sync-profile",
  body: async (input: UserProfile): Promise<SyncResult> => {
    const db = getDB("main-db");
    const dbOperations = createDbOperations(db);
    return await syncUserProfile(input, dbOperations);
  },
});

export default createWorkflow({
  name: "user-profile-sync",
  mainJob: syncProfile,
});
