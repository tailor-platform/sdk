import { ResolverBundler } from "./bundler";
import { PipelineResolverServiceConfig } from "./types";

export class PipelineResolverService {
  private bundler: ResolverBundler;

  constructor(
    public readonly namespace: string,
    config: PipelineResolverServiceConfig,
  ) {
    this.bundler = new ResolverBundler(namespace, config);
  }

  async build() {
    await this.bundler.bundle();
  }
}
