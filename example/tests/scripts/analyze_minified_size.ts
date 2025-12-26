import * as fs from "node:fs";
import * as path from "node:path";
import { build } from "tsdown";

interface LibraryModule {
  name: string;
  code: string;
  startLine: number;
  endLine: number;
}

interface MinifiedResult {
  library: string;
  modules: number;
  originalSize: number;
  minifiedSize: number;
  compressionRatio: number;
}

/**
 * Parse transformed.js and extract modules by #region
 */
function extractModules(filePath: string): Map<string, LibraryModule[]> {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const libraryMap = new Map<string, LibraryModule[]>();

  let currentRegion: string | null = null;
  let currentStartLine = 0;
  let currentCode: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const regionMatch = /^\/\/#region (.+)$/.exec(line);
    if (regionMatch) {
      currentRegion = regionMatch[1].trim();
      currentStartLine = i + 1;
      currentCode = [];
      continue;
    }

    if (/^\/\/#endregion$/.exec(line)) {
      if (currentRegion) {
        const module: LibraryModule = {
          name: currentRegion,
          code: currentCode.join("\n"),
          startLine: currentStartLine,
          endLine: i,
        };

        // Group by library
        let libraryName: string;
        if (currentRegion.includes("node_modules/")) {
          // Extract library name: for @scoped packages, get @scope/package
          // For regular packages, get only the first segment
          const match = /node_modules\/(@[^/]+\/[^/]+|[^/]+)/.exec(currentRegion);
          libraryName = match ? match[1] : "unknown";
        } else if (currentRegion.includes("packages/sdk/")) {
          libraryName = "@tailor-platform/sdk";
        } else {
          libraryName = "[user-code]";
        }

        if (!libraryMap.has(libraryName)) {
          libraryMap.set(libraryName, []);
        }
        libraryMap.get(libraryName)!.push(module);
      }
      currentRegion = null;
      currentCode = [];
      continue;
    }

    if (currentRegion) {
      currentCode.push(line);
    }
  }

  return libraryMap;
}

/**
 * Add exports to all top-level declarations
 */
function addExports(code: string): string {
  const lines = code.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("/*")) {
      result.push(line);
      continue;
    }

    // Check if this is a top-level declaration (not indented)
    const isTopLevel = !line.startsWith(" ") && !line.startsWith("\t");

    if (isTopLevel) {
      // Match declarations: class, function, const, let, var
      const declarationMatch = /^(class|function|const|let|var)\s+(\w+)/.exec(line);
      if (declarationMatch && !line.startsWith("export ")) {
        // Add export
        result.push(`export ${line}`);
        continue;
      }
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Combine all modules for a library and prepare for minification
 */
function combineLibraryModules(modules: LibraryModule[]): string {
  const allCode = modules.map((m) => m.code).join("\n\n");
  return addExports(allCode);
}

/**
 * Minify code using tsdown
 */
async function minifyCode(
  code: string,
  tempDir: string,
  libraryName: string,
): Promise<{ originalSize: number; minifiedSize: number }> {
  const safeName = libraryName.replace(/[^a-zA-Z0-9-]/g, "_");
  const inputPath = path.join(tempDir, `${safeName}.js`);
  const outputPath = path.join(tempDir, `${safeName}.min.js`);

  // Write input file
  fs.writeFileSync(inputPath, code, "utf-8");
  const originalSize = Buffer.byteLength(code, "utf-8");

  try {
    // Run tsdown
    await build({
      entry: [inputPath],
      outDir: path.dirname(outputPath),
      format: ["esm"],
      minify: true,
      clean: false,
      dts: false,
      silent: true,
    });

    // Read minified output
    const minifiedPath = outputPath.replace(".min.js", ".js");
    if (!fs.existsSync(minifiedPath)) {
      throw new Error(`Minified file not found: ${minifiedPath}`);
    }

    const minifiedCode = fs.readFileSync(minifiedPath, "utf-8");
    const minifiedSize = Buffer.byteLength(minifiedCode, "utf-8");

    return { originalSize, minifiedSize };
  } catch (error) {
    console.error(`Error minifying ${libraryName}:`, error);
    return { originalSize, minifiedSize: originalSize };
  }
}

const fileSizeBase = 1000;
function formatBytes(bytes: number): string {
  if (bytes < fileSizeBase) return `${bytes} B`;
  if (bytes < fileSizeBase * fileSizeBase) return `${(bytes / fileSizeBase).toFixed(2)} KB`;
  return `${(bytes / (fileSizeBase * fileSizeBase)).toFixed(2)} MB`;
}

async function analyzeMinifiedSizes(transformedPath: string): Promise<MinifiedResult[]> {
  const libraryMap = extractModules(transformedPath);

  // Create temp directory
  const tempDir = path.join(path.dirname(transformedPath), "temp_minify");
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });

  const results: MinifiedResult[] = [];

  for (const [libraryName, modules] of libraryMap.entries()) {
    const combinedCode = combineLibraryModules(modules);
    const { originalSize, minifiedSize } = await minifyCode(combinedCode, tempDir, libraryName);

    results.push({
      library: libraryName,
      modules: modules.length,
      originalSize,
      minifiedSize,
      compressionRatio: minifiedSize / originalSize,
    });
  }

  // Cleanup temp directory
  fs.rmSync(tempDir, { recursive: true });

  return results;
}

function printResults(results: MinifiedResult[], fileName: string) {
  console.log(`=== ${fileName} ===`);

  results.sort((a, b) => b.minifiedSize - a.minifiedSize);

  const totalOriginal = results.reduce((sum, r) => sum + r.originalSize, 0);
  const totalMinified = results.reduce((sum, r) => sum + r.minifiedSize, 0);

  // Calculate max library name length for proper alignment
  const maxLibraryNameLength = Math.max(...results.map((r) => r.library.length), "Library".length);
  const libraryColWidth = Math.max(maxLibraryNameLength + 2, 35);
  const modulesColWidth = 8;
  const originalColWidth = 12;
  const minifiedColWidth = 12;
  const percentColWidth = 12;
  const totalWidth =
    libraryColWidth +
    modulesColWidth +
    originalColWidth +
    minifiedColWidth +
    percentColWidth +
    /* spaces between columns */ 5;

  console.log("─".repeat(totalWidth));
  console.log(
    `${"Library".padEnd(libraryColWidth)} ${"Modules".padStart(modulesColWidth)} ${"Original".padStart(originalColWidth)} ${"Minified".padStart(minifiedColWidth)} ${"% of Total".padStart(percentColWidth)}`,
  );
  console.log("─".repeat(totalWidth));

  for (const result of results) {
    const percentage = ((result.minifiedSize / totalMinified) * 100).toFixed(2);

    console.log(
      `${result.library.padEnd(libraryColWidth)} ${result.modules.toString().padStart(modulesColWidth)} ${formatBytes(result.originalSize).padStart(originalColWidth)} ${formatBytes(result.minifiedSize).padStart(minifiedColWidth)} ${(percentage + "%").padStart(percentColWidth)}`,
    );
  }

  console.log("─".repeat(totalWidth));

  const totalModules = results.reduce((sum, r) => sum + r.modules, 0);
  console.log(
    `${"TOTAL".padEnd(libraryColWidth)} ${totalModules.toString().padStart(modulesColWidth)} ${formatBytes(totalOriginal).padStart(originalColWidth)} ${formatBytes(totalMinified).padStart(minifiedColWidth)} ${"100.00%".padStart(percentColWidth)}`,
  );

  console.log("─".repeat(totalWidth) + "\n");
}

// Main execution
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const actualDir = path.join(__dirname, "../fixtures/actual");

// Check if a specific file was provided as argument
const targetFile = process.argv[2];

async function analyzeFile(filePath: string) {
  const fileName = path.basename(filePath);

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    return;
  }

  try {
    const results = await analyzeMinifiedSizes(filePath);
    printResults(results, fileName);
  } catch (error) {
    console.error(`Error analyzing ${fileName}:`, error);
  }
}

async function analyzeAllTransformedFiles() {
  // Find all .transformed.js files
  const transformedFiles: string[] = [];

  function findTransformedFiles(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        findTransformedFiles(fullPath);
      } else if (entry.name.endsWith(".transformed.js")) {
        transformedFiles.push(fullPath);
      }
    }
  }

  findTransformedFiles(actualDir);

  if (transformedFiles.length === 0) {
    console.error("No .transformed.js files found");
    process.exit(1);
  }

  for (const filePath of transformedFiles) {
    await analyzeFile(filePath);
  }
}

// Run analysis
if (targetFile) {
  // Analyze specific file
  const filePath = path.isAbsolute(targetFile) ? targetFile : path.join(process.cwd(), targetFile);

  analyzeFile(filePath).catch((error) => {
    console.error("Error during analysis:", error);
    process.exit(1);
  });
} else {
  // Analyze all .transformed.js files
  analyzeAllTransformedFiles().catch((error) => {
    console.error("Error during analysis:", error);
    process.exit(1);
  });
}
