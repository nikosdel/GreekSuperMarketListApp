import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

if (!process.env.TOKEN_SECRET || process.env.TOKEN_SECRET.length < 32) {
  console.error("Set TOKEN_SECRET in .env to a random string of at least 32 characters.");
  process.exit(1);
}

const { createApp } = await import("./app.js");

const port = Number(process.env.API_PORT || 3000);
const app = createApp();
app.listen(port, "127.0.0.1", () => {
  console.log(`API listening on http://127.0.0.1:${port}`);
});
