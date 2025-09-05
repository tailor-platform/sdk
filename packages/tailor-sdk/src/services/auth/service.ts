import { type AuthServiceInput } from "./types";

export class AuthService {
  constructor(public readonly config: AuthServiceInput) {}
}
