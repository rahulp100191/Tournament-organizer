import { readFile } from "node:fs/promises";
import { database } from "../server/db.js";
await database.query(
  await readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
);
console.log(
  "Database schema ready. No sample accounts or events were inserted.",
);
