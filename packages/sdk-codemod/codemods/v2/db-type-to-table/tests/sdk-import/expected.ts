import { db, defineConfig } from "@tailor-platform/sdk";
import { db as schema } from "@tailor-platform/sdk";
import * as sdk from "@tailor-platform/sdk";

export const user = db.table("User", {
  name: db.string(),
});

export const project = schema.table("Project", {
  title: schema.string(),
});

export const team = sdk.db.table("Team", {
  label: sdk.db.string(),
});

const local = {
  type: (name: string) => name,
};

local.type("NoChange");

function useLocalDb(db: { type: (name: string) => string }) {
  return db.type("NoChange");
}

{
  const schema = {
    type: (name: string) => name,
  };
  schema.type("NoChange");
}

defineConfig({});
