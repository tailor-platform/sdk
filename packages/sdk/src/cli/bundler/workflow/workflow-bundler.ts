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
  exportName: string;
  sourceFile: string;
  deps?: string[];
}

/**
 * Bundle workflow jobs
 *
 * This function:
 * 1. Uses a transform plugin to remove deps during bundling (preserves module resolution)
 * 2. Creates entry file
 * 3. Bundles in a single step with tree-shaking
 */
export async function bundleWorkflowJobs(allJobs: JobInfo[]): Promise<void> {
  if (allJobs.length === 0) {
    console.log("No workflow jobs to bundle");
    return;
  }

  console.log(`Found ${allJobs.length} files for service "workflow-job"`);

  const outputDir = path.resolve(getDistDir(), "workflow-jobs");

  fs.mkdirSync(outputDir, { recursive: true });

  let tsconfig: string | undefined;
  try {
    tsconfig = await resolveTSConfig();
  } catch {
    tsconfig = undefined;
  }

  // Process each job
  await Promise.all(
    allJobs.map((job) => bundleSingleJob(job, allJobs, outputDir, tsconfig)),
  );

  console.log('Successfully bundled files for service "workflow-job"');
}

async function bundleSingleJob(
  job: JobInfo,
  allJobs: JobInfo[],
  outputDir: string,
  tsconfig: string | undefined,
): Promise<void> {
  // Step 1: Find deps for this job to create the jobs proxy object
  const depsJobNames = findJobDeps(job.name, allJobs);
  const jobsObject = generateJobsObject(depsJobNames);

  // Step 2: Create entry file that imports job by named export
  const entryPath = path.join(outputDir, `${job.name}.entry.js`);
  const absoluteSourcePath = path.resolve(job.sourceFile).replace(/\\/g, "/");

  const entryContent = ml /* js */ `
    import { ${job.exportName} } from "${absoluteSourcePath}";

    const jobs = {
      ${jobsObject}
    };

    globalThis.main = async (input) => {
      return await ${job.exportName}.body(input, jobs);
    };
  `;
  fs.writeFileSync(entryPath, entryContent);

  // Step 3: Bundle with a transform plugin that removes deps from target job
  const outputPath = path.join(outputDir, `${job.name}.js`);

  // Collect export names for enhanced AST removal (catches jobs missed by AST detection)
  const otherJobExportNames = allJobs
    .filter((j) => j.name !== job.name)
    .map((j) => j.exportName);

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
function findJobDeps(targetJobName: string, allJobs: JobInfo[]): string[] {
  const targetJob = allJobs.find((j) => j.name === targetJobName);
  return targetJob?.deps ?? [];
}

function generateJobsObject(jobNames: string[]): string {
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
