import sql from "sqlstring";

//#region constants.ts
const defaultMachineUserRole = "4293a799-4398-55e6-a19a-fe8427d1a415";

//#endregion
//#region tailordb/permissions.ts

//#endregion
//#region tailordb/role.ts

//#endregion
//#region tailordb/user.ts

//#endregion
//#region executors/userCreated.ts

//#endregion

// Export the executor function
export const __executor_function = async({newRecord,client})=>{const record=await client.execOne(sql.format(`select * from User where id = ?`,[newRecord.id]));console.log(`New user created: ${record.name} (${record.email})`)};