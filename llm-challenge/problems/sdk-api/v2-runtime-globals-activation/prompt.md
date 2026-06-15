Create a minimal Tailor SDK project with a small piece of runtime code that reaches the runtime APIs the platform injects into the global scope at execution time (the ambient namespaces a deployed function can call without importing anything).

Configure the project so this code type-checks under a project type check, without depending on any implicit or automatic activation of those ambient types. The chosen approach should keep working even if the SDK stops turning those types on for you by default.

Keep the implementation small and leave the finished project files in this workspace.
