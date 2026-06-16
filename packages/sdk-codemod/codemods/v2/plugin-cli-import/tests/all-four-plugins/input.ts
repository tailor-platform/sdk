import { kyselyTypePlugin, enumConstantsPlugin, fileUtilsPlugin, seedPlugin } from "@tailor-platform/sdk/cli";

export const plugins = [kyselyTypePlugin(), enumConstantsPlugin(), fileUtilsPlugin(), seedPlugin()];
