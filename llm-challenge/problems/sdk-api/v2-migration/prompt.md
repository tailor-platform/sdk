Migrate the project in this workspace to the next major SDK version.

Start from the existing files rather than replacing the project. Use the package's local migration documentation and automation where appropriate, then finish any manual updates that the automation does not cover.

The finished workspace should preserve the small customer lookup, workflow launch, runtime file-read, runtime global, configuration, and unit-test surfaces, but should no longer rely on removed or deprecated migration-era patterns.

Run the project type check and leave the migrated project files in this workspace.
