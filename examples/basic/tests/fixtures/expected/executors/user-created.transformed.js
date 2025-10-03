import { createExecutor, db, recordCreatedTrigger } from "@tailor-platform/tailor-sdk";

//#region tailordb/permissions.ts
const defaultMachineUser = [
	{ user: "role" },
	"=",
	"ADMIN"
];
const loggedIn = [
	{ user: "_loggedIn" },
	"=",
	true
];
const defaultPermission = {
	create: [defaultMachineUser],
	read: [defaultMachineUser, loggedIn],
	update: [defaultMachineUser],
	delete: [defaultMachineUser]
};
const defaultGqlPermission = [{
	conditions: [defaultMachineUser],
	actions: [
		"create",
		"read",
		"update",
		"delete",
		"aggregate",
		"bulkUpsert"
	],
	permit: true
}, {
	conditions: [loggedIn],
	actions: ["read"],
	permit: true
}];

//#endregion
//#region tailordb/user.ts
const user = db.type("User", {
	name: db.string(),
	email: db.string().unique(),
	status: db.string({ optional: true }),
	department: db.string({ optional: true }),
	role: db.enum("ADMIN", "USER"),
	...db.fields.timestamps()
}).files({ avatar: "profile image" }).indexes({
	fields: ["name", "department"],
	unique: false
}, {
	fields: ["status", "createdAt"],
	unique: false,
	name: "user_status_created_idx"
}).permission(defaultPermission).gqlPermission(defaultGqlPermission);

//#endregion
//#region executors/userRecordLog.ts
var userRecordLog_default = async ({ newRecord, client }) => {
	const record = await client.execOne(`select * from User where id = ?`, [newRecord.id]);
	console.log(`New user created: ${record.name} (${record.email})`);
};

//#endregion
//#region executors/userCreated.ts
var userCreated_default = createExecutor("user-created", "Triggered when a new user is created").on(recordCreatedTrigger(user, ({ newRecord }) => newRecord.email.endsWith("@tailor.tech"))).executeFunction({
	fn: async (args) => {
		await userRecordLog_default(args);
	},
	dbNamespace: "tailordb"
});

//#endregion
export { userCreated_default as default };

// Export the executor function
export const __executor_function = async (args) => {
		await userRecordLog_default(args);
	};