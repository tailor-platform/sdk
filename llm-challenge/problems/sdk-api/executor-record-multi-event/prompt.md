Create a minimal Tailor SDK project that reacts to customer record changes.

One executor-style handler should be connected to more than one customer record event so it can write or log a compact audit message for both creation and update activity. A reviewer should be able to inspect the source and see the set of record events handled by the same handler.

Keep the implementation small and leave the finished project files in this workspace.
