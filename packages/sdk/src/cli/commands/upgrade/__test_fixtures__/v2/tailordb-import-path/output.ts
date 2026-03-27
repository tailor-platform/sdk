import { db } from "@tailor-platform/sdk/schema";
import type { TailorDBType } from "@tailor-platform/sdk/schema";

const customerType: TailorDBType = db.type({
  name: "Customer",
  fields: {
    name: db.string({ required: true }),
  },
});

export default customerType;
