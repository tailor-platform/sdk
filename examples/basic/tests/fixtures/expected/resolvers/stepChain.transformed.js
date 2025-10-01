import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";
import { format } from "/dummy/path/node_modules/date-fns/index.js";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "/dummy/path/node_modules/kysely/dist/esm/index.js";

//#region generated/tailordb.ts
const getDB = () => {
	return new Kysely({ dialect: {
		createAdapter: () => new PostgresAdapter(),
		createDriver: () => new DummyDriver(),
		createIntrospector: (db) => new PostgresIntrospector(db),
		createQueryCompiler: () => new PostgresQueryCompiler()
	} });
};
async function kyselyWrapper(context, callback) {
	const db = getDB();
	const clientWrapper = { exec: async (query) => {
		return await context.client.exec(query.sql, query.parameters);
	} };
	return await callback({
		...context,
		db,
		client: clientWrapper
	});
}

//#endregion
//#region resolvers/stepChain/resolver.ts
const resolver = createQueryResolver("stepChain", t.type({ user: t.object({
	name: t.object({
		first: t.string(),
		last: t.string()
	}),
	activatedAt: t.datetime({ optional: true })
}) }), { defaults: { dbNamespace: "tailordb" } }).fnStep("step1", (context) => {
	return `step1: Hello ${context.input.user.name.first} ${context.input.user.name.last} on step1!`;
}).fnStep("step2", async () => {
	return `step2: recorded ${format(/* @__PURE__ */ new Date(), "yyyy-MM-dd HH:mm:ss")} on step2!`;
}).sqlStep("sqlStep", async (context) => {
	const result = await context.client.execOne(`SELECT name FROM User ORDER BY createdAt DESC`);
	return result ? result.name : "no user found";
}).sqlStep("kyselyStep", (context) => kyselyWrapper(context, async (context$1) => {
	const query = context$1.db.selectFrom("Supplier").select(["state"]).compile();
	return (await context$1.client.exec(query)).map((r) => r.state).join(", ");
})).returns((context) => ({ result: { summary: [
	context.step1,
	context.step2,
	context.sqlStep,
	context.kyselyStep
] } }), t.type({ result: t.object({ summary: t.string({ array: true }) }) }));
var resolver_default = resolver;

//#endregion
export { resolver_default as default };

export const $tailor_resolver_step__step1 = (context) => {
	return `step1: Hello ${context.input.user.name.first} ${context.input.user.name.last} on step1!`;
};
export const $tailor_resolver_step__step2 = async () => {
	return `step2: recorded ${format(/* @__PURE__ */ new Date(), "yyyy-MM-dd HH:mm:ss")} on step2!`;
};
export const $tailor_resolver_step__sqlStep = async (context) => {
	const result = await context.client.execOne(`SELECT name FROM User ORDER BY createdAt DESC`);
	return result ? result.name : "no user found";
};
export const $tailor_resolver_step__kyselyStep = (context) => kyselyWrapper(context, async (context$1) => {
	const query = context$1.db.selectFrom("Supplier").select(["state"]).compile();
	return (await context$1.client.exec(query)).map((r) => r.state).join(", ");
});
