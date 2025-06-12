import { ResolverBundler } from "./bundler";
import { PipelineResolverServiceConfig } from "./types";
import { measure } from "../performance";

export class PipelineResolverService {
  private bundler: ResolverBundler;

  constructor(
    public readonly namespace: string,
    config: PipelineResolverServiceConfig,
  ) {
    this.bundler = new ResolverBundler(namespace, config);
  }

  @measure
  async build() {
    await this.bundler.bundle();
  }
}
