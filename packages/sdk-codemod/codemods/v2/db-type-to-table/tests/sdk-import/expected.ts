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

export const optional = db.table?.("Optional", {
  label: db.string(),
});

export const optionalTeam = sdk.db.table?.("OptionalTeam", {
  label: sdk.db.string(),
});

const local = {
  type: (name: string) => name,
};

local.type("NoChange");

function useLocalDb(db: { type: (name: string) => string }) {
  return db.type("NoChange");
}

const useBareArrowDb = (db) => db.type("NoChange");

const useBareArrowNamespace = (sdk) => sdk.db.type("NoChange");

{
  const schema = {
    type: (name: string) => name,
  };
  schema.type("NoChange");
}

{
  const { db } = {
    db: {
      type: (name: string) => name,
    },
  };
  db.type("NoChange");
}

for (const db of [{ type: (name: string) => name }]) {
  db.type("NoChange");
}

try {
  throw {
    type: (name: string) => name,
  };
} catch (db) {
  db.type("NoChange");
}

defineConfig({});
