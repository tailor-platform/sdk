import { convertConfigs } from "../../../../src/workspace-config/convert";
import type { ProjectChanges, ProjectFiles } from "../../../../src/types";

export function transformProject(project: ProjectFiles): ProjectChanges {
  return convertConfigs(project, "app");
}
