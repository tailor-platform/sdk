// Default-export a mutation resolver named "cancel" that returns
// { success, error } in every branch:
// - "sub-active"   -> { success: true,  error: "" }
// - "sub-canceled" -> { success: false, error: "Not active" }
// - anything else  -> { success: false, error: "Not found" }
// See problem.md for the full requirements.
