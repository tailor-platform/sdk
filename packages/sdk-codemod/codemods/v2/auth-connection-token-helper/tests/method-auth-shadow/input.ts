import { auth } from "../tailor.config";

export const token = await auth.getConnectionToken("google");

class Client {
  async run(auth: { getConnectionToken(name: string): Promise<string> }) {
    return auth.getConnectionToken("github");
  }
}
