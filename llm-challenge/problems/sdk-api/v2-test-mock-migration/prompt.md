Create a minimal Tailor SDK project with a single resolver-style operation that queries the project's database and returns a small result derived from what it reads.

Add a unit test for that operation that runs without connecting to any deployed platform. The test must not reach a real database; instead, use the SDK's official testing mock facility to stand in for the database, supply a canned response, invoke the operation, and assert on the returned result. Wire up whatever test setup the SDK expects so the test runs against the same runtime surface the operation uses in production.

Keep the implementation small and leave the finished project and its test files in this workspace.
