import { readFile, writeFile } from "node:fs/promises";
import { database } from "../server/db.js";
import { exportData, restoreData } from "../server/backup.js";
const [operation, path] = process.argv.slice(2);
if (
  !path?.endsWith(".rally-backup.json") ||
  !["export", "restore"].includes(operation)
)
  throw new Error(
    "Usage: npm run db:backup -- export|restore file.rally-backup.json",
  );
if (operation === "export") {
  await writeFile(path, JSON.stringify(await exportData(database)), {
    flag: "wx",
  });
  console.log(
    "Export complete. This file contains private data; store it securely.",
  );
} else {
  await restoreData(database, JSON.parse(await readFile(path, "utf8")));
  console.log("Restore complete.");
}
process.exit(0);
