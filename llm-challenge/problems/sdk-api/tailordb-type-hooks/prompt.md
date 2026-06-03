Create a minimal Tailor SDK project for support tickets in TailorDB.

Add custom behavior around ticket writes so new tickets get normalized status values and invalid priority values are rejected before they are stored. A reviewer should be able to inspect the source and see where the write-time behavior is attached to the ticket record.

Keep the implementation small and leave the finished project files in this workspace.
