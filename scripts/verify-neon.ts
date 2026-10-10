import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Database, Sql } from "../server/db.js";
import {
  saveProfile,
  saveEvent,
  eventStatus,
  register,
  acceptPartner,
  type Account,
} from "../server/domain.js";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
// A temporary, isolated schema keeps verification data out of the application.
const schema = "rally_check_" + randomUUID().replaceAll("-", "");
if (!/^rally_check_[a-f0-9]+$/.test(schema))
  throw new Error("Invalid test schema.");
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 6,
  connectionTimeoutMillis: 15000,
});
async function transaction<T>(fn: (tx: Sql) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO ${schema}`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
const db: Database = {
  transaction,
  query: (q, p) => transaction((tx) => tx.query(q, p)),
};
let created = false;
try {
  await pool.query(`CREATE SCHEMA ${schema}`);
  created = true;
  await db.query(
    await readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
  );
  const accounts: Account[] = Array.from({ length: 4 }, (_, i) => ({
    id: randomUUID(),
    email: `check${i}@example.test`,
    role: i === 0 ? "admin" : "athlete",
  }));
  for (const a of accounts)
    await db.query(
      "INSERT INTO accounts(id,firebase_uid,email,role) VALUES($1,$2,$3,$4)",
      [a.id, a.id, a.email, a.role],
    );
  const athletes = [];
  for (const a of accounts.slice(1))
    athletes.push(
      await saveProfile(db, a, {
        kind: "self",
        name: "Test athlete",
        dob: "1995-01-01",
        gender: "male",
        state: "Assam",
        city: "Guwahati",
        phone: "9999999999",
        sports: [
          {
            sport: "Futsal",
            level: "Amateur",
            years: 1,
            primary_sport: false,
            categories: ["team"],
            rankings: [],
          },
          {
            sport: "Badminton",
            level: "Amateur",
            years: 1,
            primary_sport: true,
            categories: ["singles"],
            rankings: [],
          },
        ],
      }),
    );
  const iso = (days: number) =>
      new Date(Date.now() + days * 86400000).toISOString(),
    admin = accounts[0];
  const eventData = {
    name: "Isolated concurrency check",
    sport: "Badminton",
    state: "Assam",
    city: "Guwahati",
    venue: "Test court",
    details: {
      description: "Database contention verification tournament.",
      organizer_name: "Test Organiser",
      contact_phone: "9999999999",
      contact_email: "organiser@example.test",
      address: "Test Court, Main Road",
    },
    starts_at: iso(7),
    ends_at: iso(8),
    registration_deadline: iso(6),
    withdrawal_deadline: iso(5),
    age_cutoff: iso(7).slice(0, 10),
    rules: "Test event only; no payment or real entrants.",
    refund_policy: "No real money is collected in testing.",
    categories: [
      {
        name: "Final slot",
        entry_type: "singles",
        format: "knockout",
        capacity: 2,
        fee: 0,
        min_age: 18,
        max_age: 100,
        gender: "any",
        levels: ["Amateur"],
      },
    ],
  };
  const event = await saveEvent(db, admin, eventData);
  await eventStatus(db, admin, event, "published");
  const cat = (
    await db.query("SELECT id FROM categories WHERE event_id=$1", [event])
  ).rows[0].id;
  const enter = (i: number) =>
    register(db, accounts[i + 1], {
      category_id: cat,
      athlete_id: athletes[i],
      accepted_rules: true,
      idempotency_key: randomUUID(),
      emergency_contact: "Test contact",
    });
  await enter(0);
  const results = await Promise.allSettled([enter(1), enter(2)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM entries WHERE category_id=$1 AND status='confirmed'",
        [cat],
      )
    ).rows[0].n,
    2,
  );
  console.log(
    "Neon pooled connections verified: one concurrent final-slot request succeeded; one was rejected.",
  );
  const teamEvent = await saveEvent(db, admin, {
    ...eventData,
    name: "Isolated Futsal team check",
    sport: "Futsal",
    categories: [
      {
        ...eventData.categories[0],
        entry_type: "team",
        team_min: 3,
        team_max: 5,
        scoring_mode: "score",
        best_of: 1,
      },
    ],
  });
  await eventStatus(db, admin, teamEvent, "published");
  const teamCat = (
    await db.query("SELECT id FROM categories WHERE event_id=$1", [teamEvent])
  ).rows[0].id;
  const team = await register(db, accounts[1], {
    category_id: teamCat,
    athlete_id: athletes[0],
    team_name: "Isolated Test Team",
    roster_size: 3,
    emergency_contact: "Test contact",
    accepted_rules: true,
    idempotency_key: randomUUID(),
  });
  await Promise.all([
    acceptPartner(db, accounts[2], team.invite_token, athletes[1]),
    acceptPartner(db, accounts[3], team.invite_token, athletes[2]),
  ]);
  assert.equal(
    (await db.query("SELECT status FROM entries WHERE id=$1", [team.id]))
      .rows[0].status,
    "confirmed",
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM entry_members WHERE entry_id=$1",
        [team.id],
      )
    ).rows[0].n,
    3,
  );
  console.log(
    "Neon custom-sport whole-team registration and concurrent roster acceptance verified.",
  );
} finally {
  if (created) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
  console.log("Isolated verification schema removed.");
}
