execSync("tailor --env-file \".env local\" function test-run a.ts");
execSync('tailor -e \'.env local\' function test-run a.ts');
