//#region constants.ts
const defaultMachineUserRole = "4293a799-4398-55e6-a19a-fe8427d1a415";

//#endregion
//#region tailordb/permissions.ts
const defaultMachineUser = [
	{ user: "roleId" },
	"=",
	defaultMachineUserRole
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
//#region tailordb/role.ts

//#endregion
//#region tailordb/user.ts

//#endregion
//#region executors/userRecordLog.ts
var userRecordLog_default = async ({ newRecord, client }) => {
	const record = await client.execOne(`select * from User where id = ?`, [newRecord.id]);
	console.log(`New user created: ${record.name} (${record.email})`);
};

//#endregion
//#region executors/userCreated.ts

//#endregion

// Export the executor function
export const __executor_function = async (args) => {
		await userRecordLog_default(args);
	};