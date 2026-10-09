import type { Database } from "./db.js";
import { fail } from "./domain.js";
export const tables = [
  "accounts",
  "athletes",
  "athlete_sports",
  "ranking_reviews",
  "events",
  "categories",
  "entries",
  "entry_members",
  "payments",
  "payment_references",
  "payment_corrections",
  "uploads",
  "refunds",
  "matches",
  "awards",
  "announcements",
  "notifications",
  "saved_events",
  "disputes",
  "audit",
] as const;
export async function exportData(db: Database) {
  return db.transaction(async (tx) => {
    await tx.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    const data: Record<string, unknown[]> = {};
    for (const table of tables)
      data[table] = (
        await tx.query(`SELECT row_to_json(t) AS row FROM ${table} t`)
      ).rows.map((r) => r.row);
    return { version: 1, exported_at: new Date().toISOString(), tables: data };
  });
}
export async function restoreData(db: Database, input: any) {
  if (input?.version !== 1 || !input.tables) fail(400, "Unsupported backup.");
  return db.transaction(async (tx) => {
    for (const table of tables) {
      if (!Array.isArray(input.tables[table]))
        fail(400, "Missing backup table: " + table);
      if ((await tx.query(`SELECT 1 FROM ${table} LIMIT 1`)).rows.length)
        fail(409, "Restore requires an empty migrated database.");
    }
    for (const table of tables) {
      for (const row of input.tables[table])
        await tx.query(
          `INSERT INTO ${table} SELECT * FROM json_populate_record(NULL::${table},$1::json)`,
          [
            JSON.stringify(
              table === "matches" ? { ...row, next_match: null } : row,
            ),
          ],
        );
    }
    for (const row of input.tables.matches)
      if (row.next_match)
        await tx.query("UPDATE matches SET next_match=$2 WHERE id=$1", [
          row.id,
          row.next_match,
        ]);
    return { restored: true };
  });
}
