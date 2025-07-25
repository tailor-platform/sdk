import { createQueryResolver, t } from "@tailor-platform/tailor-sdk";
import { format } from "date-fns";
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from "kysely";

//#region tailordb.ts
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
		return await context.client.exec(query.sql);
	} };
	return await callback({
		...context,
		db,
		client: clientWrapper
	});
}

//#endregion
//#region resolvers/stepChain/resolver.ts
var resolver_default = createQueryResolver("stepChain", t.type({ user: t.object({ name: t.object({
	first: t.string(),
	last: t.string()
}) }) }), { defaults: { dbNamespace: "tailordb" } }).fnStep("step1", (context) => {
	return `step1: Hello ${context.input.user.name.first} ${context.input.user.name.last} on step1!`;
}).fnStep("step2", async () => {
	return `step2: recorded ${format(/* @__PURE__ */ new Date(), "yyyy-MM-dd HH:mm:ss")} on step2!`;
}).sqlStep("sqlStep", async (context) => {
	const result = await context.client.execOne(`SELECT name FROM User`);
	return result.name;
}).sqlStep("kyselyStep", (context) => kyselyWrapper(context, async (context$1) => {
	const query = context$1.db.selectFrom("Supplier").select(["state"]).compile();
	return (await context$1.client.exec(query)).map((r) => r.state).join(", ");
})).returns((context) => ({ result: { summary: [
	context.step1,
	context.step2,
	context.sqlStep,
	context.kyselyStep
] } }), t.type({ result: t.object({ summary: t.string().array() }) }));

//#endregion
export { resolver_default as default };