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

//#endregion

export const $tailor_resolver_step__step1 = context=>{return`step1: Hello ${context.input.user.name.first} ${context.input.user.name.last} on step1!`};
export const $tailor_resolver_step__step2 = async()=>{return`step2: recorded ${format(new Date,"yyyy-MM-dd HH:mm:ss")} on step2!`};
export const $tailor_resolver_step__sqlStep = async context=>{const result=await context.client.execOne(`SELECT name FROM User`);return result.name};
export const $tailor_resolver_step__kyselyStep = context=>kyselyWrapper(context,async context2=>{const query=context2.db.selectFrom("Supplier").select(["state"]).compile();return(await context2.client.exec(query)).map(r=>r.state).join(", ")});
