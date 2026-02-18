import "dotenv/config";

console.log("[boot] bootstrap start");

// Use require to allow logging before/after loading the server module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require("./server");

console.log("[boot] bootstrap loaded server module");
