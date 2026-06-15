Create a minimal Tailor SDK project with a small piece of runtime code that downloads a large file stored in a record's file field and reads it incrementally rather than all at once.

Use the SDK's current, non-deprecated streaming download facility for stored files. Consume the resulting stream the standard way: pull successive chunks until the stream is exhausted and process each chunk as it is read, without buffering the whole file in memory.

Keep the implementation small and leave the finished project files in this workspace.
