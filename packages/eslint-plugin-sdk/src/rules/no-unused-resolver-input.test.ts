import { describe } from "vitest";
import { runRuleTests } from "./test-helpers.js";

const RULE = "no-unused-resolver-input";

function unused(field: string): string {
  return `Input field \`${field}\` is never read by \`body\`, so a caller may expect it to take effect. Read it in \`body\`, or remove it from \`input\`.`;
}

function resolver({
  input = "{ a: t.string(), b: t.string() }",
  body,
  permission,
  prelude = "",
}: {
  input?: string;
  body: string;
  permission?: string;
  prelude?: string;
}): string {
  const bodyProperty = /^(async )?body\(/.test(body) ? body : `body: ${body}`;
  return [
    'import { createResolver, t } from "@tailor-platform/sdk";',
    prelude,
    "export default createResolver({",
    '  name: "r",',
    '  operation: "mutation",',
    `  input: ${input},`,
    ...(permission === undefined ? [] : [`  permission: ${permission},`]),
    `  ${bodyProperty},`,
    "  output: t.int(),",
    "});",
  ].join("\n");
}

describe("reports input fields body never reads", () => {
  runRuleTests(RULE, {
    invalid: [
      "({ input }) => input.a",
      "({ input }) => input?.a",
      '({ input }) => input["a"]',
      "({ input }) => (input).a",
      "(ctx) => ctx.input.a",
      "(ctx) => ctx.input?.a",
      "(ctx) => (ctx?.input)?.a",
      "({ input: { a } }) => a",
      "({ input: args }) => args.a",
      "({ input = {} }) => input.a",
      "function (ctx) { const { input } = ctx; return input.a; }",
      "({ input }) => { const { a } = input; return a; }",
      "(ctx) => { const input = ctx.input; return input.a; }",
      "({ input }) => { const args = input; return args.a; }",
      "({ input }) => { let args = input; return args.a; }",
      "(ctx) => { const c = ctx; return c.input.a; }",
      "body(ctx) { return ctx.input.a; }",
      "async body({ input }) { return input.a; }",
      "async ({ input }: { input: { a: string } }): Promise<string> => input.a",
      "({ input }: { input: unknown }) => (input as { a: string }).a",
      "({ input }) => input!.a",
      "({ input }) => { type T = typeof input.b; return input.a; }",
      "({ input }) => { const read = (input: { b: string }) => input.b; return input.a; }",
    ].map((body) => ({ code: resolver({ body }), errors: [unused("b")] })),
  });
});

describe("reports every field when body reads none", () => {
  runRuleTests(RULE, {
    invalid: [
      "() => 1",
      "({ caller }) => caller",
      "(ctx) => ctx.caller?.id ?? ctx.env.x",
      "({ input }) => 1",
    ].map((body) => ({ code: resolver({ body }), errors: [unused("a"), unused("b")] })),
  });
});

describe("counts reads in parameter defaults", () => {
  runRuleTests(RULE, {
    valid: [
      "({ input, x = input.b }) => input.a",
      "(ctx, b = ctx.input.b) => ctx.input.a",
      "({ input }, b = input.b) => input.a",
    ].map((body) => resolver({ body })),
  });
});

describe("leaves bodies whose reads it cannot tell unreported", () => {
  runRuleTests(RULE, {
    valid: [
      "({ input }) => helper(input)",
      "({ input }) => ({ ...input })",
      "({ input }) => save({ input })",
      "({ input }) => input",
      "({ input }) => input[key]",
      '({ input }) => "b" in input && input.a',
      '({ input }) => input.hasOwnProperty("b") && input.a',
      "({ input }) => { const { a, toString } = input; return toString() + a; }",
      "({ input: { a, valueOf } }) => valueOf() + a",
      "({ input }) => { let args = input; args = {}; return args.a; }",
      "({ input: { a, ...rest } }) => rest",
      "({ input }) => { const { a, ...rest } = input; return rest; }",
      "({ input: { [key]: value } }) => value",
      "({ ...ctx }) => ctx.input.a",
      "([ctx]) => ctx.input.a",
      "(ctx) => helper(ctx)",
      "(ctx) => ctx[key].a",
      "function () { return arguments[0].input.a; }",
    ].map((body) => resolver({ body })),
  });
});

describe("resolves body through same-file declarations", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: resolver({ prelude: "const handler = ({ input }) => input.a;", body: "handler" }),
        errors: [unused("b")],
      },
      {
        code: resolver({
          prelude: "function handler({ input }) { return input.a; }",
          body: "handler",
        }),
        errors: [unused("b")],
      },
    ],
    valid: [
      resolver({ prelude: 'import { handler } from "./handler";', body: "handler" }),
      resolver({ body: "createHandler()" }),
      resolver({
        prelude: "function handler({ input }) { return input.a; }\nhandler = other;",
        body: "handler",
      }),
      resolver({
        prelude: [
          "function handler(ctx: { input: { a: string } }): string;",
          "function handler({ input }) { return input.a; }",
        ].join("\n"),
        body: "handler",
      }),
    ],
  });
});

describe("treats inputs that permission compares with the caller as used", () => {
  const binding = '[{ conditions: [[{ input: "b" }, "=", { user: "id" }]], permit: true }]';
  runRuleTests(RULE, {
    valid: [
      resolver({ body: "({ input }) => input.a", permission: binding }),
      resolver({
        prelude: `const permission = ${binding};`,
        body: "({ input }) => input.a",
        permission: "permission",
      }),
      resolver({
        body: "({ input }) => input.a",
        permission:
          '[{ conditions: [{ user: "id" }, "=", { input: "b" }], permit: true }, { conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }]',
      }),
    ],
    invalid: [
      {
        code: resolver({
          body: "({ input }) => input.a",
          permission: '[{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }]',
        }),
        errors: [unused("b")],
      },
      {
        code: resolver({ body: "({ input }) => input.a", permission: '"allowAnonymous"' }),
        errors: [unused("b")],
      },
    ],
  });
});

describe("skips resolvers whose permission cannot be read statically", () => {
  runRuleTests(RULE, {
    valid: [
      resolver({
        prelude: 'import { permission } from "./permission";',
        body: "({ input }) => input.a",
        permission: "permission",
      }),
      resolver({ body: "({ input }) => input.a", permission: "[...policies]" }),
      resolver({
        body: "({ input }) => input.a",
        permission: '[{ conditions: [[{ input: field }, "=", { user: "id" }]], permit: true }]',
      }),
      resolver({
        body: "({ input }) => input.a",
        permission: '[{ conditions: [[operand, "=", { user: "id" }]], permit: true }]',
      }),
      resolver({
        prelude: 'import { policy } from "./policy";',
        body: "({ input }) => input.a",
        permission: '[{ conditions: [[{ user: "role" }, "=", "ADMIN"]], permit: true }, policy]',
      }),
      resolver({
        prelude: 'import { conditions } from "./conditions";',
        body: "({ input }) => input.a",
        permission: "[{ conditions, permit: true }]",
      }),
      resolver({
        prelude: 'import { condition } from "./condition";',
        body: "({ input }) => input.a",
        permission: '[{ conditions: [[{ user: "role" }, "=", "ADMIN"], condition], permit: true }]',
      }),
    ],
  });
});

describe("treats inputs that declare a validate as used", () => {
  runRuleTests(RULE, {
    valid: [
      resolver({
        input: "{ a: t.string(), b: t.bool().validate(({ value }) => value) }",
        body: "({ input }) => input.a",
      }),
      resolver({
        input:
          "{ a: t.string(), b: t.object({ age: t.int().validate(({ value }) => value >= 18) }) }",
        body: "({ input }) => input.a",
      }),
      resolver({
        prelude: "const bField = t.string().validate(({ value }) => value.length > 0);",
        input: "{ a: t.string(), b: bField }",
        body: "({ input }) => input.a",
      }),
    ],
    invalid: [
      {
        code: resolver({
          prelude: "const bField = t.string();",
          input: "{ a: t.string(), b: bField }",
          body: "({ input }) => input.a",
        }),
        errors: [unused("b")],
      },
      {
        code: resolver({
          prelude: 'const STATUSES = ["open", "closed"];',
          input:
            '{ a: t.string(), b: t.enum(STATUSES, { optional: true }).description("note"), c: t.object({ d: t.string() }) }',
          body: "({ input }) => input.a",
        }),
        errors: [unused("b"), unused("c")],
      },
    ],
  });
});

describe("leaves fields it cannot see into unreported", () => {
  runRuleTests(RULE, {
    valid: [
      resolver({
        prelude: 'import { bField } from "./fields";',
        input: "{ a: t.string(), b: bField }",
        body: "({ input }) => input.a",
      }),
      resolver({
        prelude: 'import { profile } from "./profile";',
        input: "{ a: t.string(), b: t.object({ ...profile.fields }) }",
        body: "({ input }) => input.a",
      }),
      resolver({
        prelude:
          'const emailField = () => t.string().validate(({ value }) => value.includes("@"));',
        input: "{ a: t.string(), b: emailField() }",
        body: "({ input }) => input.a",
      }),
      resolver({
        prelude: "function emailField() { return t.string(); }",
        input: "{ a: t.string(), b: emailField() }",
        body: "({ input }) => input.a",
      }),
    ],
  });
});

describe("skips resolvers whose config cannot be read statically", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createResolver } from "@tailor-platform/sdk";\nimport { config } from "./config";\nexport default createResolver(config);',
      'import { createResolver, t } from "@tailor-platform/sdk";\nimport { base } from "./base";\nexport default createResolver({ ...base, input: { a: t.string() }, body: () => 1 });',
      resolver({ prelude: 'import { fields } from "./fields";', input: "fields", body: "() => 1" }),
      resolver({ input: "{ ...shared, a: t.string() }", body: "() => 1" }),
      'import { createResolver, t } from "@tailor-platform/sdk";\nexport default createResolver({ name: "r", input: { a: t.string() }, get body() { return () => 1; } });',
    ],
  });
});

describe("ignores createResolver from other packages", () => {
  runRuleTests(RULE, {
    valid: [
      'import { createResolver, t } from "other";\nexport default createResolver({ name: "r", input: { a: t.string() }, body: () => 1 });',
    ],
  });
});

describe("reports on the field declaration", () => {
  runRuleTests(RULE, {
    invalid: [
      {
        code: [
          'import * as sdk from "@tailor-platform/sdk";',
          "const input = {",
          "  a: sdk.t.string(),",
          "  b: sdk.t.string(),",
          "};",
          'export default sdk.createResolver({ name: "r", input, body: ({ input }) => input.a });',
        ].join("\n"),
        errors: [{ message: unused("b"), line: 4 }],
      },
    ],
  });
});
