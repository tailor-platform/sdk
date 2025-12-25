/**
 * Resolver Nested Object Types Performance Test
 *
 * Tests type inference cost for nested object types in input/output
 */
import { createResolver, t } from "../../../src/configure";

export const resolver0 = createResolver({
  name: "resolver0",
  operation: "query",
  input: {
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
  },
  body: async (context) => ({
    user: context.input.user,
    success: true,
  }),
  output: t.object({
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
    success: t.bool(),
  }),
});

export const resolver1 = createResolver({
  name: "resolver1",
  operation: "query",
  input: {
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
  },
  body: async (context) => ({
    user: context.input.user,
    success: true,
  }),
  output: t.object({
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
    success: t.bool(),
  }),
});

export const resolver2 = createResolver({
  name: "resolver2",
  operation: "query",
  input: {
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
  },
  body: async (context) => ({
    user: context.input.user,
    success: true,
  }),
  output: t.object({
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
    success: t.bool(),
  }),
});

export const resolver3 = createResolver({
  name: "resolver3",
  operation: "query",
  input: {
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
  },
  body: async (context) => ({
    user: context.input.user,
    success: true,
  }),
  output: t.object({
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
    success: t.bool(),
  }),
});

export const resolver4 = createResolver({
  name: "resolver4",
  operation: "query",
  input: {
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
  },
  body: async (context) => ({
    user: context.input.user,
    success: true,
  }),
  output: t.object({
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
    success: t.bool(),
  }),
});

export const resolver5 = createResolver({
  name: "resolver5",
  operation: "query",
  input: {
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
  },
  body: async (context) => ({
    user: context.input.user,
    success: true,
  }),
  output: t.object({
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
    success: t.bool(),
  }),
});

export const resolver6 = createResolver({
  name: "resolver6",
  operation: "query",
  input: {
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
  },
  body: async (context) => ({
    user: context.input.user,
    success: true,
  }),
  output: t.object({
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
    success: t.bool(),
  }),
});

export const resolver7 = createResolver({
  name: "resolver7",
  operation: "query",
  input: {
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
  },
  body: async (context) => ({
    user: context.input.user,
    success: true,
  }),
  output: t.object({
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
    success: t.bool(),
  }),
});

export const resolver8 = createResolver({
  name: "resolver8",
  operation: "query",
  input: {
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
  },
  body: async (context) => ({
    user: context.input.user,
    success: true,
  }),
  output: t.object({
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
    success: t.bool(),
  }),
});

export const resolver9 = createResolver({
  name: "resolver9",
  operation: "query",
  input: {
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
  },
  body: async (context) => ({
    user: context.input.user,
    success: true,
  }),
  output: t.object({
    user: t.object({
      name: t.string(),
      email: t.string(),
      profile: t.object({
        age: t.int(),
        bio: t.string({ optional: true }),
      }),
    }),
    success: t.bool(),
  }),
});
