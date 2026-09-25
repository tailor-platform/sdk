import { z } from "zod";

export const profileNameSchema = z.string().min(1, "Profile must not be empty");
