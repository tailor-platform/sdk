import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "formatName",
  operation: "mutation",
  input: {
    firstName: t.string(),
    lastName: t.string(),
    uppercase: t.bool({ optional: true }),
  },
  body: ({ input }) => {
    const fullName = input.uppercase
      ? `${input.firstName} ${input.lastName}`.toUpperCase()
      : `${input.firstName} ${input.lastName}`;
    const initials = `${input.firstName[0].toUpperCase()}${input.lastName[0].toUpperCase()}`;
    return { fullName, initials };
  },
  output: t.object({
    fullName: t.string(),
    initials: t.string(),
  }),
});
