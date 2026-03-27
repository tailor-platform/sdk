import { db } from "@tailor-platform/sdk/tailordb";

export default db.type({
  name: "Customer",
  fields: {
    name: db.string({ required: true }),
    email: db.string({ required: true, unique: true }),
    age: db.integer(),
  },
  indexes: {
    nameIndex: {
      fields: [{ field: "name", order: "asc" }],
    },
  },
});
