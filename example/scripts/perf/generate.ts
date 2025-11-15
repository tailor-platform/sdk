import { count } from "node:console";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const counts: Record<string, number> = {
  types: 50,
  resolvers: 200,
  executors: 100,
};

function generateTypes(): string {
  let code = `import { db } from "@tailor-platform/sdk";\n\n`;

  for (let i = 0; i < counts.types; i++) {
    code += `export const model${i} = db.type("Model${i}", {
  name: db.string(),
  description: db.string({ optional: true }),
  value: db.int(),
  isActive: db.bool(),
  ...db.fields.timestamps(),
});\n\n`;
  }

  return code;
}

function generateResolvers(): string {
  let code = `import { createResolver, t } from "@tailor-platform/sdk";\n\n`;

  for (let i = 0; i < counts.resolvers; i++) {
    const operation = i % 2 === 0 ? "query" : "mutation";
    code += `export const resolver${i} = createResolver({
  name: "resolver${i}",
  operation: "${operation}",
  input: {
    id: t.string(),
    name: t.string(),
    value: t.int(),
  },
  body: async (context) => {
    return {
      id: context.input.id,
      name: context.input.name,
      value: context.input.value,
      processed: true,
    };
  },
  output: t.object({
    id: t.string(),
    name: t.string(),
    value: t.int(),
    processed: t.bool(),
  }),
});\n\n`;
  }

  return code;
}

function generateExecutors(): string {
  let code = `import { createExecutor, scheduleTrigger, incomingWebhookTrigger } from "@tailor-platform/sdk";\n\n`;

  for (let i = 0; i < counts.executors; i++) {
    // Alternate between scheduleTrigger and incomingWebhookTrigger to test different trigger types
    const triggerCode =
      i % 2 === 0
        ? `scheduleTrigger({ cron: "0 0 * * *" })`
        : `incomingWebhookTrigger()`;

    code += `export const executor${i} = createExecutor({
  name: "executor${i}",
  description: "Executor ${i} description",
  trigger: ${triggerCode},
  operation: {
    kind: "graphql",
    appName: "my-app",
    query: \`
      mutation createLog($input: LogInput!) {
        createLog(input: $input) {
          id
        }
      }
    \`,
    variables: () => ({
      input: {
        timestamp: new Date().toISOString(),
        executorId: "${i}",
      },
    }),
  },
});\n\n`;
  }

  return code;
}

function main() {
  const baseDir = join(__dirname, "../..");
  const generatedDir = join(baseDir, "generated-perf");

  console.log(`Generating performance test code...`);
  console.log(`- ${counts.types} TailorDB models`);
  console.log(`- ${counts.resolvers} resolvers`);
  console.log(`- ${counts.executors} executors`);

  mkdirSync(generatedDir, { recursive: true });

  const typesCode = generateTypes();
  writeFileSync(join(generatedDir, "types.ts"), typesCode);

  const resolversCode = generateResolvers();
  writeFileSync(join(generatedDir, "resolvers.ts"), resolversCode);

  const executorsCode = generateExecutors();
  writeFileSync(join(generatedDir, "executors.ts"), executorsCode);

  console.log(`Generated code in generated-perf/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
