// One-time setup for running BuyBelow on your own computer:  npm run setup
// Creates a private local database (inside .wrangler/, never uploaded) and a .dev.vars settings file.
import { execSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: ["ignore", "ignore", "inherit"] });

console.log("Creating the local database…");
run("npx wrangler d1 execute buybelow-waitlist --local --yes --file db/schema.sql");
run("npx wrangler d1 execute buybelow-waitlist --local --yes --file db/schema_app.sql");

if (existsSync(".dev.vars")) {
  console.log("Keeping your existing .dev.vars file.");
} else {
  copyFileSync(".dev.vars.example", ".dev.vars");
  console.log("Created .dev.vars. Open it and paste your Twelve Data key if you want real prices.");
}
console.log("\nDone. Start the app with:  npm run dev\nThen open  http://localhost:8787/app");
