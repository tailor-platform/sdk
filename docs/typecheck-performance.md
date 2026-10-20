# Typecheck compiler comparison

The SDK and example native compiler lane uses `tsrs` instead of `tsgo`. The stable TypeScript 6 `tsc` lane remains unchanged, including template checks, compiler API consumers, and type inference metrics.

## Measurement on 2026-10-21 (JST)

- Baseline: commit `60d945e51`, `@typescript/native-preview@7.0.0-dev.20260707.2`.
- Replacement: `tsrs@0.16.0-ts7.1.0-dev.20260929`, reporting TypeScript `7.1.0-dev.20260930.4` (`microsoft/TypeScript@b85298b6a81f`).
- Machine: Apple M3 Pro, macOS 27.0 arm64, Node.js v26.10.0, pnpm 12.14.0, Python 3.9.
- Same worktree, tsconfig options, and generated SDK/example sources. Only development tooling configuration and the orchestration test changed between measurements. The platform fallback runner was added afterward; timings measure the compiler command directly and exclude that runner’s Node.js startup.
- Each command ran sequentially, with no build/test/other benchmark running concurrently. Wall time includes `pnpm exec` and compiler startup; build/install/generation are excluded.
- Each package/cache/compiler combination has one discarded preparation run followed by five measured runs. The table reports medians. All compiler runs exited successfully.
- Cold means deleting only the dedicated incremental buildinfo before every invocation. Warm means reusing it without source edits. OS/filesystem caches were not cleared.
- This compares the actual migration, including the underlying TypeScript version change. It does not isolate the effect of implementation language or predict CI duration; CI runs other checks concurrently.

| Package      | Cache | Before: tsgo | After: tsrs | Speedup |
| ------------ | ----- | ------------ | ----------- | ------- |
| packages/sdk | cold  | 3.361 s      | 0.838 s     | 4.01x   |
| packages/sdk | warm  | 0.740 s      | 0.223 s     | 3.31x   |
| example      | cold  | 1.266 s      | 0.292 s     | 4.34x   |
| example      | warm  | 0.574 s      | 0.166 s     | 3.45x   |

Raw measured wall times (seconds, in execution order):

| Package      | Cache | Compiler | Five samples                                     |
| ------------ | ----- | -------- | ------------------------------------------------ |
| packages/sdk | cold  | tsgo     | 3.774883, 3.082700, 3.290702, 3.496537, 3.360843 |
| packages/sdk | cold  | tsrs     | 0.791208, 0.838289, 0.620513, 0.841136, 0.846751 |
| packages/sdk | warm  | tsgo     | 0.872307, 0.795957, 0.723230, 0.331820, 0.740295 |
| packages/sdk | warm  | tsrs     | 0.530410, 0.210205, 0.202064, 0.543993, 0.223343 |
| example      | cold  | tsgo     | 1.490856, 2.430927, 1.265665, 1.022560, 1.085179 |
| example      | cold  | tsrs     | 0.550920, 0.261807, 0.234508, 0.533140, 0.291592 |
| example      | warm  | tsgo     | 0.676549, 0.573856, 0.270714, 0.587984, 0.258997 |
| example      | warm  | tsrs     | 0.164119, 0.157075, 0.166131, 0.517706, 0.168017 |

## Reproduce

Save the following standard-library-only script as `/tmp/benchmark-typecheck.py`. Run from a prepared repository root. It uses a separate `.benchmark.tsbuildinfo` in each package, removes it on completion/failure, checks exit codes, and verifies that incremental caches were actually written.

```python
import json
import os
import pathlib
import platform
import statistics
import subprocess
import time

compiler = os.environ['COMPILER']
results = {'compiler': compiler, 'node': subprocess.check_output(['node', '--version'], text=True).strip(), 'pnpm': subprocess.check_output(['pnpm', '--version'], text=True).strip(), 'platform': platform.platform(), 'measurements': []}
for directory in ['packages/sdk', 'example']:
    version = subprocess.check_output(['pnpm', 'exec', compiler, '--version'], cwd=directory, text=True).strip()
    cache = pathlib.Path(directory) / '.benchmark.tsbuildinfo'
    command = ['pnpm', 'exec', compiler, '--noEmit', '--incremental', '--tsBuildInfoFile', './.benchmark.tsbuildinfo']
    for mode in ['cold', 'warm']:
        times = []
        try:
            cache.unlink(missing_ok=True)
            for run in range(6):
                if mode == 'cold':
                    cache.unlink(missing_ok=True)
                start = time.perf_counter()
                result = subprocess.run(command, cwd=directory, capture_output=True, text=True)
                elapsed = time.perf_counter() - start
                if result.returncode:
                    raise RuntimeError(result.stdout + result.stderr)
                if not cache.is_file():
                    raise RuntimeError('Compiler did not write incremental cache')
                if run:
                    times.append(round(elapsed, 6))
            measurement = {'directory': directory, 'version': version, 'mode': mode, 'command': command, 'seconds': times, 'median': statistics.median(times)}
            results['measurements'].append(measurement)
            print(json.dumps(measurement), flush=True)
        finally:
            cache.unlink(missing_ok=True)
pathlib.Path(os.environ['RESULTS']).write_text(json.dumps(results, indent=2) + '\n')
```

For the baseline, create a worktree at `60d945e51`; for the replacement, use this branch. In each worktree, prepare the packages before measuring:

```sh
pnpm install
pnpm build
pnpm --filter @tailor-platform/sdk --filter example run generate
```

Run these commands in their respective worktrees, sequentially on the same machine:

```sh
# Baseline worktree
COMPILER=tsgo RESULTS=/tmp/tsgo-before.json python3 /tmp/benchmark-typecheck.py

# Replacement worktree
COMPILER=tsrs RESULTS=/tmp/tsrs-after.json python3 /tmp/benchmark-typecheck.py
```

Both execute the following command in `packages/sdk` and `example`, changing only the executable:

```sh
pnpm exec tsgo --noEmit --incremental --tsBuildInfoFile ./.benchmark.tsbuildinfo
pnpm exec tsrs --noEmit --incremental --tsBuildInfoFile ./.benchmark.tsbuildinfo
```

The JSON files preserve versions, environment, exact commands, individual samples, and medians. Do not run builds, tests, or source edits during measurement.

## Dependency constraints

Version 0.16.0 satisfies the repository's three-day release age policy. The newer 0.18.0 did not at measurement time. The npm name was transferred to this project; the exact-version `trustPolicyExclude` entry is backed by [the official release provenance](https://github.com/oxc-project/tsrs/actions/runs/38932536526/attempts/1).

This pinned release ships binaries for macOS arm64 and Linux x64/arm64 (glibc/musl). It has no Windows or Intel macOS binary. See [upstream compatibility](https://github.com/oxc-project/tsrs/blob/main/docs/COMPATIBILITY.md). `typecheck:rs` uses stable `tsc` on platforms without a binary, including Windows and Intel macOS. On supported platforms, compiler errors or startup failures fail the check without falling back. The stable `pnpm typecheck` command continues to use `tsc`.
