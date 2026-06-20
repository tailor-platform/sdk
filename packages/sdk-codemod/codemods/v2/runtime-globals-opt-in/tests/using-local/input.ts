export {};

using tailor = getClient();
tailor.run();

await using tailordb = getDatabase();
tailordb.run();
