import * as v from "valibot";

export const profileNameSchema = v.pipe(v.string(), v.minLength(1, "Profile must not be empty"));
