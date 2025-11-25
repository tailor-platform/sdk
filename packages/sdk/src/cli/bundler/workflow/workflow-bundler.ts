import * as fs from "node:fs";
import * as path from "node:path";
import { camelize } from "inflection";
import ml from "multiline-ts";
import { resolveTSConfig } from "pkg-types";
import * as rolldown from "rolldown";
import { getDistDir } from "@/configure/config";
import { transformWorkflowSource } from "./ast-transformer";

interface JobInfo {
  name: string;
  exportName?: string; // undefined if accessed via workflow.mainJob
  sourceFile: string;
}

/**
 * Simplified workflow bundler that:
 * 1. Uses a transform plugin to remove deps during bundling (preserves module resolution)
 * 2. Creates entry file
 * 3. Bundles in a single step with tree-shaking
 */
export class WorkflowBundler {
  constructor(private allJobs: JobInfo[]) {}

  async bundle(): Promise<void> {
    if (this.allJobs.length === 0) {
      console.log("No workflow jobs to bundle");
      return;
    }

    console.log(
      `Found ${this.allJobs.length} files for service "workflow-job"`,
    );

    const outputDir = path.resolve(getDistDir(), "workflow-jobs");
    const entryDir = path.resolve(getDistDir(), "workflow-jobs-entry");

    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(entryDir, { recursive: true });

    let tsconfig: string | undefined;
    try {
      tsconfig = await resolveTSConfig();
    } catch {
      tsconfig = undefined;
    }

    // Process each job
    await Promise.all(
      this.allJobs.map((job) =>
        this.bundleJob(job, entryDir, outputDir, tsconfig),
      ),
    );

    console.log('Successfully bundled files for service "workflow-job"');
  }

  private async bundleJob(
    job: JobInfo,
    entryDir: string,
    outputDir: string,
    tsconfig: string | undefined,
  ): Promise<void> {
    // Step 1: Find deps for this job to create the jobs proxy object
    const depsJobNames = this.findJobDeps(job.name);
    const jobsObject = this.generateJobsObject(depsJobNames);

    // Step 2: Create entry file that imports from the original source
    const entryPath = path.join(entryDir, `${job.name}.js`);
    const absoluteSourcePath = path.resolve(job.sourceFile).replace(/\\/g, "/");

    // Generate entry content based on whether the job is exported or accessed via workflow
    let entryContent: string;
    if (job.exportName) {
      // Job is exported - import directly by name
      entryContent = ml /* js */ `
        import { ${job.exportName} } from "${absoluteSourcePath}";

        const jobs = {
          ${jobsObject}
        };

        globalThis.main = async (input) => {
          return await ${job.exportName}.body(input, jobs);
        };
      `;
    } else {
      // Job is not exported - access via workflow.mainJob (default export)
      entryContent = ml /* js */ `
        import workflow from "${absoluteSourcePath}";

        const jobs = {
          ${jobsObject}
        };

        globalThis.main = async (input) => {
          return await workflow.mainJob.body(input, jobs);
        };
      `;
    }
    fs.writeFileSync(entryPath, entryContent);

    // Step 3: Bundle with a transform plugin that removes deps from target job
    const outputPath = path.join(outputDir, `${job.name}.js`);

    // Collect export names for enhanced AST removal (catches jobs missed by AST detection)
    // Filter out undefined exportNames (jobs accessed via workflow.mainJob)
    const otherJobExportNames = this.allJobs
      .filter((j) => j.name !== job.name && j.exportName !== undefined)
      .map((j) => j.exportName) as string[];

    // Create transform plugin to remove deps from target job and other job declarations
    const transformPlugin: rolldown.Plugin = {
      name: "workflow-transform",
      transform: {
        filter: {
          id: {
            include: [/\.ts$/, /\.js$/],
          },
        },
        handler(code) {
          // Only transform source files that contain workflow jobs
          if (!code.includes("createWorkflowJob")) {
            return null;
          }
          const transformed = transformWorkflowSource(
            code,
            job.name,
            job.exportName,
            otherJobExportNames,
          );
          return { code: transformed };
        },
      },
    };

    await rolldown.build(
      rolldown.defineConfig({
        input: entryPath,
        output: {
          file: outputPath,
          format: "esm",
          sourcemap: true,
          minify: true,
          inlineDynamicImports: true,
        },
        tsconfig,
        plugins: [transformPlugin],
        treeshake: {
          moduleSideEffects: false,
          annotations: true,
          unknownGlobalSideEffects: false,
        },
        logLevel: "silent",
      }) as rolldown.BuildOptions,
    );
  }

  /**
   * Find the dependencies of a specific job
   */
  private findJobDeps(targetJobName: string): string[] {
    // Import the job module to get its deps
    // Since we're in bundling context, we need to check the allJobs for relationships
    // The deps are tracked in the WorkflowJobLoader when collecting jobs
    // For now, we'll collect deps by re-importing the source
    // This is a simplification - in production, deps should be passed from the loader

    // For this implementation, we return empty and let the entry file handle it
    // The actual deps are resolved at runtime via the jobs proxy
    return this.allJobs
      .filter((j) => j.name !== targetJobName)
      .map((j) => j.name);
  }

  private generateJobsObject(jobNames: string[]): string {
    if (jobNames.length === 0) {
      return "";
    }
    return jobNames
      .map((jobName) => {
        const camelCaseName = camelize(jobName.replace(/-/g, "_"), true);
        return `"${camelCaseName}": (args) => tailor.workflow.triggerJobFunction("${jobName}", args)`;
      })
      .join(",\n        ");
  }
}
