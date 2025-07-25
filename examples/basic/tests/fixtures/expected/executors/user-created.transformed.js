import sql from "sqlstring";

//#region tailordb/user.ts

//#endregion
//#region executors/userCreated.ts

//#endregion

// Export the executor function
export const __executor_function = async({newRecord,client})=>{const record=await client.execOne(sql.format(`select * from User where id = ?`,[newRecord.id]));console.log(`New user created: ${record.name} (${record.email})`)};