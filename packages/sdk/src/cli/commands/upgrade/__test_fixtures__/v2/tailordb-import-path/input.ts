import { db } from "@tailor-platform/sdk/tailordb";
import type { TailorDBType } from "@tailor-platform/sdk/tailordb";

const customerType: TailorDBType = db.type({
  name: "Customer",
  fields: {
    name: db.string({ required: true }),
  },
});

export default customerType;
