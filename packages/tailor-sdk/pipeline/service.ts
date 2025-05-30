import { ResolverBundler } from "./bundler";
import { ResolverServiceConfig } from "./types";

export class PipelineResolverService {
  public name: string;
  private config: ResolverServiceConfig;
  private bundler: ResolverBundler;

  constructor(config: ResolverServiceConfig) {
    this.name = config.namespace;
    this.config = config;
    this.bundler = new ResolverBundler(this.config);
  }

  async build() {
    await this.bundler.bundle();
  }
}
