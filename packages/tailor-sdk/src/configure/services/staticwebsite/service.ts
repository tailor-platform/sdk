import { type StaticWebsiteServiceInput } from "./types";

export class StaticWebsiteService {
  private websites: Record<string, StaticWebsiteServiceInput> = {};

  constructor(
    public readonly name: string,
    public readonly config: StaticWebsiteServiceInput,
  ) {
    this.websites[name] = config;
  }
}
