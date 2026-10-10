import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../server/db.js";
import {
  acceptPartner,
  eventStatus,
  register,
  reviewPayment,
  saveEvent,
  saveProfile,
  submitPayment,
  withdraw,
  type Account,
} from "../server/domain.js";
import {
  draw,
  recordResult,
  roundRobin,
  seedSlots,
} from "../server/competition.js";
import { createApp } from "../server/app.js";
import { standings } from "../server/competition.js";
import { exportData, restoreData } from "../server/backup.js";
let pg: PGlite, db: Database, server: any, url: string;
const admin: Account = {
  id: randomUUID(),
  email: "admin@example.test",
  role: "admin",
};
const people: Account[] = Array.from({ length: 12 }, (_, i) => ({
  id: randomUUID(),
  email: `player${i}@example.test`,
  role: "athlete",
}));
const profile = (i: number, overrides: any = {}) => ({
  kind: "self",
  name: "Player " + i,
  dob: "1995-06-12",
  gender: i % 2 ? "female" : "male",
  state: "Assam",
  city: "Guwahati",
  phone: "9999999999",
  is_public: false,
  sports: [
    {
      sport: "Badminton",
      level: "Amateur",
      years: 3,
      primary_sport: true,
      categories: ["singles", "doubles"],
      rankings: [],
    },
    {
      sport: "Tennis",
      level: "Beginner",
      years: 1,
      primary_sport: false,
      categories: ["singles"],
      rankings: [],
    },
  ],
  ...overrides,
});
const athletes: string[] = [];
const iso = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString();
async function event(overrides: any = {}, catOverrides: any = {}) {
  const id = await saveEvent(db, admin, {
    name: "Test Open",
    sport: "Badminton",
    city: "Guwahati",
    state: "Assam",
    venue: "Test Court",
    details: {
      description: "A friendly community tournament.",
      organizer_name: "Test Organiser",
      contact_phone: "9999999999",
      contact_email: "organiser@example.test",
      address: "Test Court, Main Road, Guwahati",
    },
    starts_at: iso(7),
    ends_at: iso(8),
    registration_deadline: iso(6),
    withdrawal_deadline: iso(5),
    age_cutoff: iso(7).slice(0, 10),
    refund_policy: "Full refunds before the withdrawal deadline.",
    rules: "Fair play. Bring your own racket and arrive on time.",
    categories: [
      {
        name: "Open",
        entry_type: "singles",
        format: "knockout",
        capacity: 8,
        fee: 50000,
        min_age: 18,
        max_age: 100,
        gender: "any",
        levels: ["Amateur"],
        best_of: 1,
        ...catOverrides,
      },
    ],
    ...overrides,
  });
  return {
    id,
    category: (
      await db.query("SELECT * FROM categories WHERE event_id=$1", [id])
    ).rows[0],
  };
}
const entry = (category_id: string, i: number, key = randomUUID()) =>
  register(db, people[i], {
    category_id,
    athlete_id: athletes[i],
    emergency_contact: "Contact 9999999999",
    accepted_rules: true,
    idempotency_key: key,
  });
async function paid(
  category: string,
  i: number,
  reference = "TEST-" + randomUUID().replaceAll("-", ""),
) {
  const en = await entry(category, i);
  const p = await submitPayment(
    db,
    people[i],
    en.id,
    { reference, payer_name: "Test payer", paid_at: new Date().toISOString() },
    "test",
  );
  await reviewPayment(db, admin, p, true, "Verified test submission");
  return en.id;
}
async function request(
  path: string,
  user: number | "admin" | null = null,
  method = "GET",
  body?: any,
) {
  const r = await fetch(url + "/api/v1" + path, {
    method,
    headers: {
      Connection: "close",
      ...(user === null
        ? {}
        : {
            Authorization:
              "Bearer " + (user === "admin" ? "admin" : String(user)),
          }),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() };
}
before(async () => {
  pg = new PGlite();
  await pg.exec(
    await readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
  );
  db = {
    query: (q, p) => pg.query(q, p) as any,
    transaction: (fn) =>
      pg.transaction((tx) => fn({ query: (q, p) => tx.query(q, p) as any })),
  };
  for (const a of [admin, ...people])
    await db.query(
      "INSERT INTO accounts(id,firebase_uid,email,role) VALUES($1,$2,$3,$4)",
      [a.id, a.id, a.email, a.role],
    );
  for (let i = 0; i < people.length; i++)
    athletes.push(await saveProfile(db, people[i], profile(i)));
  process.env.ADMIN_EMAILS = admin.email;
  const app = createApp({
    db,
    authenticate: async (req) => {
      const token = req.headers.authorization?.replace("Bearer ", "");
      const a = token === "admin" ? admin : people[Number(token)];
      if (!token || !a)
        throw Object.assign(new Error("Sign in required."), { status: 401 });
      return { uid: a.id, email: a.email, verified: true };
    },
    storage: {
      put: async () =>
        ({
          url: "https://example.test/evidence.jpg",
          pathname: "proof/test.jpg",
        }) as any,
      get: async () =>
        ({
          statusCode: 200,
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.close();
            },
          }),
        }) as any,
      del: async () => {},
    } as any,
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  url = "http://127.0.0.1:" + server.address().port;
});
test("Custom-sport tournaments require public organiser fields and athlete-only profile controls", async () => {
  const incomplete = await event({ sport: "futsal", details: {} });
  await assert.rejects(
    eventStatus(db, admin, incomplete.id, "published"),
    /description, organiser/,
  );
  const complete = await event({ sport: "Ultimate Frisbee" });
  await eventStatus(db, admin, complete.id, "published");
  const published = (await request("/events/" + complete.id)).json.data;
  assert.equal(published.sport, "Ultimate Frisbee");
  assert.equal(published.details.contact_email, "organiser@example.test");
  assert.equal(
    (await request("/me/profiles", "admin", "POST", profile(0))).status,
    403,
  );
  assert.equal(
    (await request("/me/profiles/" + athletes[0], "admin", "PUT", profile(0)))
      .status,
    403,
  );
  assert.equal(
    (await request("/me/profiles/" + athletes[0], "admin", "DELETE")).status,
    403,
  );
  assert.equal(
    (await request("/admin/rankings/review", "admin", "POST", {})).status,
    404,
  );
  await assert.rejects(saveEvent(db, people[0], {}), /Only Admin/);
});

test("Whole teams require independent athlete consent, one complete roster per slot, one payment, and team-named fixtures", async () => {
  const players: { account: Account; id: string }[] = [];
  for (let i = 0; i < 9; i++) {
    const account: Account = {
      id: randomUUID(),
      email: `team-${randomUUID()}@example.test`,
      role: "athlete",
    };
    await db.query(
      "INSERT INTO accounts(id,firebase_uid,email,role) VALUES($1,$2,$3,$4)",
      [account.id, account.id, account.email, account.role],
    );
    const id = await saveProfile(
      db,
      account,
      profile(i, {
        ...(i === 2
          ? {
              kind: "junior",
              dob: "2017-06-12",
              guardian_name: "Test Guardian",
              guardian_relationship: "Parent",
              consent: true,
            }
          : {}),
        sports: [
          {
            sport: "futsal",
            level: "Amateur",
            years: 2,
            primary_sport: true,
            categories: ["team"],
            rankings: [],
          },
        ],
      }),
    );
    players.push({ account, id });
  }
  const tournament = await event(
    { sport: "Futsal" },
    {
      entry_type: "team",
      min_age: 8,
      capacity: 2,
      team_min: 3,
      team_max: 5,
      scoring_mode: "score",
      best_of: 1,
    },
  );
  await eventStatus(db, admin, tournament.id, "published");
  const start = (i: number, name: string, size = 3) =>
    register(db, players[i].account, {
      category_id: tournament.category.id,
      athlete_id: players[i].id,
      team_name: name,
      roster_size: size,
      emergency_contact: "Contact 9999999999",
      accepted_rules: true,
      idempotency_key: randomUUID(),
    });
  await assert.rejects(start(0, "Too small", 2), /roster size/);
  const first = await start(0, "Rally Reds");
  await assert.rejects(start(0, "Rally Reds"), /already has an entry/);
  await assert.rejects(
    submitPayment(
      db,
      players[0].account,
      first.id,
      {
        reference: "TEST-NOTREADY",
        payer_name: "Test",
        paid_at: new Date().toISOString(),
      },
      "test",
    ),
    /cannot accept/,
  );
  await acceptPartner(
    db,
    players[1].account,
    first.invite_token,
    players[1].id,
  );
  assert.equal(
    (await db.query("SELECT status FROM entries WHERE id=$1", [first.id]))
      .rows[0].status,
    "partner_pending",
  );
  await assert.rejects(
    acceptPartner(db, players[1].account, first.invite_token, players[1].id),
    /already has an entry/,
  );
  await acceptPartner(
    db,
    players[2].account,
    first.invite_token,
    players[2].id,
  );
  const pay = await submitPayment(
    db,
    players[0].account,
    first.id,
    {
      reference: "TEST-TEAM-" + randomUUID().slice(0, 20),
      payer_name: "Captain",
      paid_at: new Date().toISOString(),
    },
    "test",
  );
  await reviewPayment(db, admin, pay, true, "Verified team test payment");
  const second = await start(3, "Rally Blues"),
    third = await start(6, "Rally Greens");
  await acceptPartner(
    db,
    players[4].account,
    second.invite_token,
    players[4].id,
  );
  await acceptPartner(
    db,
    players[7].account,
    third.invite_token,
    players[7].id,
  );
  const final = await Promise.allSettled([
    acceptPartner(db, players[5].account, second.invite_token, players[5].id),
    acceptPartner(db, players[8].account, third.invite_token, players[8].id),
  ]);
  assert.equal(final.filter((r) => r.status === "fulfilled").length, 1);
  const reserved = (
    await db.query(
      "SELECT * FROM entries WHERE category_id=$1 AND status='awaiting_payment'",
      [tournament.category.id],
    )
  ).rows;
  assert.equal(reserved.length, 1);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM entry_members WHERE entry_id=$1",
        [first.id],
      )
    ).rows[0].n,
    3,
  );
  const owner = players.find((p) => p.account.id === reserved[0].owner_id)!;
  const paid = await submitPayment(
    db,
    owner.account,
    reserved[0].id,
    {
      reference: "TEST-TEAM-" + randomUUID().slice(0, 20),
      payer_name: "Captain",
      paid_at: new Date().toISOString(),
    },
    "test",
  );
  await reviewPayment(db, admin, paid, true, "Verified second team");
  await draw(db, admin, tournament.category.id);
  const publicMatches = (await request("/events/" + tournament.id + "/matches"))
    .json.data;
  assert.ok(publicMatches[0].label_a.startsWith("Rally "));
  await recordResult(db, admin, publicMatches[0].id, {
    winner_id: publicMatches[0].entry_a,
    sets: [[250, 230]],
    outcome: "played",
    version: 0,
  });
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM awards WHERE category_id=$1",
        [tournament.category.id],
      )
    ).rows[0].n,
    6,
  );
  const mixed = await event(
    { sport: "Futsal" },
    { entry_type: "team", team_min: 2, team_max: 2, gender: "mixed", fee: 0 },
  );
  await eventStatus(db, admin, mixed.id, "published");
  const mixedEntry = await register(db, players[0].account, {
    category_id: mixed.category.id,
    athlete_id: players[0].id,
    team_name: "Mixed roster",
    roster_size: 2,
    emergency_contact: "Contact 9999999999",
    accepted_rules: true,
    idempotency_key: randomUUID(),
  });
  await assert.rejects(
    acceptPartner(
      db,
      players[6].account,
      mixedEntry.invite_token,
      players[6].id,
    ),
    /at least one male and one female/,
  );
  await acceptPartner(
    db,
    players[1].account,
    mixedEntry.invite_token,
    players[1].id,
  );
  assert.equal(
    (await db.query("SELECT status FROM entries WHERE id=$1", [mixedEntry.id]))
      .rows[0].status,
    "confirmed",
  );
});

test("Round-robin final-score draws update league points and corrections replace them", async () => {
  const e = await event(
    {},
    {
      format: "round_robin",
      scoring_mode: "score",
      best_of: 1,
      fee: 0,
      capacity: 2,
    },
  );
  await eventStatus(db, admin, e.id, "published");
  await entry(e.category.id, 0);
  await entry(e.category.id, 1);
  await draw(db, admin, e.category.id);
  const m = (
    await db.query("SELECT * FROM matches WHERE category_id=$1", [
      e.category.id,
    ])
  ).rows[0];
  await recordResult(db, admin, m.id, {
    winner_id: null,
    sets: [[0, 0]],
    outcome: "draw",
    version: 0,
  });
  const table = await standings(db, e.category.id);
  assert.ok(
    table.every(
      (row) => row.draws === 1 && row.table_points === 1 && row.losses === 0,
    ),
  );
  await recordResult(db, admin, m.id, {
    winner_id: m.entry_a,
    sets: [[2, 1]],
    outcome: "played",
    version: 1,
  });
  const corrected = await standings(db, e.category.id);
  assert.equal(corrected[0].table_points, 3);
  assert.ok(corrected.every((row) => row.draws === 0));
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM awards WHERE category_id=$1",
        [e.category.id],
      )
    ).rows[0].n,
    2,
  );
});

after(async () => {
  server?.close();
  await pg?.close();
});
test("Drafts stay private; publishing is visible to anonymous users; admin and ownership guards", async () => {
  const e = await event();
  assert.equal((await request("/events/" + e.id)).status, 404);
  assert.equal((await request("/admin/overview", 0)).status, 403);
  assert.equal((await request("/me")).status, 401);
  assert.equal(
    (await request("/me/profiles/" + athletes[1], 0, "PUT", profile(1))).status,
    404,
  );
  await eventStatus(db, admin, e.id, "published");
  assert.equal((await request("/events/" + e.id)).status, 200);
});
test("Own profile edits accept empty photo metadata and reject another owner’s private image", async () => {
  const before = (await request("/me", 10)).json.data.profiles[0];
  assert.equal(before.photo_url, null);
  const edited = {
    ...before,
    dob: String(before.dob).slice(0, 10),
    name: "Updated player",
    consent: false,
  };
  assert.equal(
    (await request("/me/profiles/" + before.id, 10, "PUT", edited)).status,
    200,
  );
  const image = randomUUID();
  await db.query(
    "INSERT INTO uploads(id,owner_id,purpose,pathname,url,content_type) VALUES($1,$2,'avatar','avatar/other','https://example.test/avatar','image/jpeg')",
    [image, people[9].id],
  );
  assert.equal(
    (
      await request("/me/profiles/" + before.id, 10, "PUT", {
        ...edited,
        photo_url: "/api/v1/me/uploads/" + image,
      })
    ).status,
    404,
  );
});
test("Multi-sport profiles and mandatory guardian consent / junior privacy", async () => {
  assert.equal(
    (await request("/me", 0)).json.data.profiles[0].sports.length,
    2,
  );
  const junior = profile(0, {
    kind: "junior",
    dob: iso(-10 * 365).slice(0, 10),
    guardian_name: "Parent",
    guardian_relationship: "Parent",
    consent: false,
  });
  await assert.rejects(() => saveProfile(db, people[0], junior));
  await assert.rejects(() =>
    saveProfile(db, people[0], { ...junior, consent: true, is_public: true }),
  );
  const child = await saveProfile(db, people[0], { ...junior, consent: true });
  const e = await event({}, { min_age: 0, max_age: 17 });
  await eventStatus(db, admin, e.id, "published");
  const en = await register(db, people[0], {
    category_id: e.category.id,
    athlete_id: child,
    accepted_rules: true,
    idempotency_key: randomUUID(),
    emergency_contact: "Parent 9999999999",
  });
  assert.equal(en.status, "awaiting_payment");
});
test("Concurrent final-slot requests cannot oversell; retry is idempotent; expired holds release", async () => {
  const e = await event({}, { capacity: 2 });
  await eventStatus(db, admin, e.id, "published");
  const key = randomUUID(),
    first = await entry(e.category.id, 0, key);
  assert.equal((await entry(e.category.id, 0, key)).id, first.id);
  const attempts = await Promise.allSettled([
    entry(e.category.id, 1),
    entry(e.category.id, 2),
  ]);
  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (
      await db.query(
        `SELECT count(*)::int n FROM entries WHERE category_id=$1 AND status='awaiting_payment'`,
        [e.category.id],
      )
    ).rows[0].n,
    2,
  );
  await db.query(
    `UPDATE entries SET reservation_expires_at=now()-interval '1 second' WHERE id=$1`,
    [first.id],
  );
  assert.equal((await entry(e.category.id, 3)).status, "awaiting_payment");
  assert.equal(
    (await db.query("SELECT status FROM entries WHERE id=$1", [first.id]))
      .rows[0].status,
    "expired",
  );
});
test("Doubles require partner acceptance, one payment and one capacity slot", async () => {
  const e = await event({}, { entry_type: "doubles", gender: "mixed" });
  await eventStatus(db, admin, e.id, "published");
  const en = await entry(e.category.id, 0);
  assert.equal(en.status, "partner_pending");
  await assert.rejects(() =>
    submitPayment(
      db,
      people[0],
      en.id,
      {
        reference: "TEST-EARLY",
        payer_name: "Tester",
        paid_at: new Date().toISOString(),
      },
      "test",
    ),
  );
  await assert.rejects(() =>
    acceptPartner(db, people[2], en.invite_token, athletes[2]),
  );
  await acceptPartner(db, people[1], en.invite_token, athletes[1]);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM entry_members WHERE entry_id=$1",
        [en.id],
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM notifications WHERE account_id IN ($1,$2)",
        [people[0].id, people[1].id],
      )
    ).rows[0].n >= 2,
    true,
  );
  const pid = await submitPayment(
    db,
    people[0],
    en.id,
    {
      reference: "TEST-TEAM",
      payer_name: "Tester",
      paid_at: new Date().toISOString(),
    },
    "test",
  );
  assert.equal(
    (await db.query("SELECT status FROM entries WHERE id=$1", [en.id])).rows[0]
      .status,
    "awaiting_verification",
  );
  await reviewPayment(db, admin, pid, true, "Test verified");
  assert.equal(
    (await db.query("SELECT status FROM entries WHERE id=$1", [en.id])).rows[0]
      .status,
    "confirmed",
  );
});
test("Payments remain pending, duplicates and repeated reviews fail, late claims obey capacity", async () => {
  const e = await event({}, { capacity: 2 });
  await eventStatus(db, admin, e.id, "published");
  const first = await entry(e.category.id, 0);
  await db.query(
    `UPDATE entries SET reservation_expires_at=now()-interval '1 second' WHERE id=$1`,
    [first.id],
  );
  await entry(e.category.id, 1);
  await entry(e.category.id, 2);
  const pid = await submitPayment(
    db,
    people[0],
    first.id,
    {
      reference: "TEST-LATE",
      payer_name: "Tester",
      paid_at: new Date().toISOString(),
    },
    "test",
  );
  assert.equal(
    (await db.query("SELECT status FROM entries WHERE id=$1", [first.id]))
      .rows[0].status,
    "needs_review_no_seat",
  );
  await assert.rejects(
    () => reviewPayment(db, admin, pid, true, "Verified"),
    /full/,
  );
  await reviewPayment(db, admin, pid, false, "Capacity full");
  await assert.rejects(() =>
    reviewPayment(db, admin, pid, true, "Second review"),
  );
  await assert.rejects(() =>
    submitPayment(db, people[1], undefined as any, {}, "test"),
  );
  const other = (
    await db.query(
      "SELECT id FROM entries WHERE category_id=$1 AND owner_id=$2",
      [e.category.id, people[1].id],
    )
  ).rows[0];
  await assert.rejects(
    () =>
      submitPayment(
        db,
        people[1],
        other.id,
        {
          reference: "test-late",
          payer_name: "Tester",
          paid_at: new Date().toISOString(),
        },
        "test",
      ),
    /reused/,
  );
  await assert.rejects(
    () =>
      submitPayment(
        db,
        people[1],
        other.id,
        {
          reference: "REAL12345",
          payer_name: "Tester",
          paid_at: new Date().toISOString(),
        },
        "test",
      ),
    /TEST-/,
  );
});
test("Evidence is private even to a doubles partner; protected response has no-store", async () => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO uploads(id,owner_id,purpose,pathname,url,content_type) VALUES($1,$2,'proof','proof/test','https://example.test/proof','image/jpeg')",
    [id, people[0].id],
  );
  assert.equal((await request("/me/uploads/" + id, 1)).status, 404);
  const r = await fetch(url + "/api/v1/me/uploads/" + id, {
    headers: { Authorization: "Bearer 0" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "private,no-store");
  assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], [1, 2, 3]);
});
test("Knockout seeding, byes, progression, score validation and point corrections", async () => {
  assert.deepEqual(seedSlots(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  const e = await event();
  await eventStatus(db, admin, e.id, "published");
  for (let i = 0; i < 3; i++) await paid(e.category.id, i);
  await draw(db, admin, e.category.id);
  let ms = (
    await db.query(
      "SELECT * FROM matches WHERE category_id=$1 ORDER BY round,position",
      [e.category.id],
    )
  ).rows;
  assert.equal(ms.filter((m) => m.status === "bye").length, 1);
  const semi = ms.find((m) => m.status === "pending" && m.round === 1);
  await assert.rejects(
    () =>
      recordResult(db, admin, semi.id, {
        winner_id: semi.entry_a,
        sets: [[15, 21]],
        outcome: "played",
        version: semi.version,
      }),
    /winner/,
  );
  await recordResult(db, admin, semi.id, {
    winner_id: semi.entry_a,
    sets: [[21, 15]],
    outcome: "played",
    version: semi.version,
  });
  const final = (
    await db.query("SELECT * FROM matches WHERE category_id=$1 AND round=2", [
      e.category.id,
    ])
  ).rows[0];
  assert.ok(final.entry_a && final.entry_b);
  await recordResult(db, admin, final.id, {
    winner_id: final.entry_a,
    sets: [[21, 15]],
    outcome: "played",
    version: final.version,
  });
  let awards = (
    await db.query("SELECT * FROM awards WHERE category_id=$1", [e.category.id])
  ).rows;
  assert.equal(awards.length, 3);
  assert.equal(
    awards.reduce((n, a) => n + a.points, 0),
    800,
  );
  await recordResult(db, admin, final.id, {
    winner_id: final.entry_b,
    sets: [[15, 21]],
    outcome: "played",
    version: final.version + 1,
  });
  awards = (
    await db.query("SELECT * FROM awards WHERE category_id=$1", [e.category.id])
  ).rows;
  assert.equal(awards.length, 3);
  assert.equal(
    awards.reduce((n, a) => n + a.points, 0),
    800,
  );
  await assert.rejects(
    () =>
      recordResult(db, admin, final.id, {
        winner_id: final.entry_a,
        sets: [[21, 15]],
        outcome: "played",
        version: final.version,
      }),
    /changed/,
  );
  await eventStatus(db, admin, e.id, "closed");
  await eventStatus(db, admin, e.id, "completed");
});
test("Round robin schedules every pair once and awards only once after completion", async () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const ids = Array.from({ length: n }, (_, i) => String(i)),
      fixtures = roundRobin(ids);
    assert.equal(fixtures.length, (n * (n - 1)) / 2);
    assert.equal(
      new Set(fixtures.map((f) => [f.a, f.b].sort().join(":"))).size,
      fixtures.length,
    );
    for (const round of new Set(fixtures.map((f) => f.round))) {
      const players = fixtures
        .filter((f) => f.round === round)
        .flatMap((f) => [f.a, f.b]);
      assert.equal(new Set(players).size, players.length);
    }
  }
  const e = await event({}, { format: "round_robin", fee: 0, capacity: 3 });
  await eventStatus(db, admin, e.id, "published");
  for (let i = 0; i < 3; i++) await entry(e.category.id, i);
  const ms = await draw(db, admin, e.category.id);
  for (const m of ms)
    await recordResult(db, admin, m.id, {
      winner_id: m.entry_a,
      sets: [[21, 15]],
      outcome: "played",
      version: m.version,
    });
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM awards WHERE category_id=$1",
        [e.category.id],
      )
    ).rows[0].n,
    3,
  );
});
test("Withdrawal before a draw and re-entry cannot create duplicate participation awards", async () => {
  const e = await event({}, { fee: 0, best_of: 1 });
  await eventStatus(db, admin, e.id, "published");
  const old = await entry(e.category.id, 6);
  await withdraw(db, people[6], old.id);
  assert.equal(
    (
      await request(
        "/admin/entries/" + old.id + "/withdrawal",
        "admin",
        "POST",
        { reason: "Test withdrawal", refund: false },
      )
    ).status,
    200,
  );
  await entry(e.category.id, 6);
  await entry(e.category.id, 7);
  const ms = await draw(db, admin, e.category.id);
  const m = ms[0];
  await recordResult(db, admin, m.id, {
    winner_id: m.entry_a,
    sets: [[21, 15]],
    outcome: "played",
    version: m.version,
  });
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM awards WHERE category_id=$1",
        [e.category.id],
      )
    ).rows[0].n,
    2,
  );
});
test("Withdrawals and cancellation create pending refund tasks and audit records", async () => {
  const e = await event();
  await eventStatus(db, admin, e.id, "published");
  const id = await paid(e.category.id, 0);
  await withdraw(db, people[0], id);
  assert.equal(
    (await db.query("SELECT status FROM entries WHERE id=$1", [id])).rows[0]
      .status,
    "withdrawal_requested",
  );
  await eventStatus(db, admin, e.id, "cancelled");
  const r = (await db.query("SELECT * FROM refunds WHERE entry_id=$1", [id]))
    .rows[0];
  assert.equal(r.status, "pending");
  const res = await request("/admin/refunds/" + r.id, "admin", "POST", {
    bank_checked: true,
    bank_reference: "TEST-REFUND",
  });
  assert.equal(res.status, 200);
  assert.equal(
    (await db.query("SELECT status FROM refunds WHERE id=$1", [r.id])).rows[0]
      .status,
    "processed",
  );
  assert.ok(
    (
      await db.query(
        `SELECT 1 FROM audit WHERE action='event.cancelled' AND entity_id=$1`,
        [e.id],
      )
    ).rows.length,
  );
});
test("Payment corrections block verification; late bank-verified funds can be refunded without a slot", async () => {
  const e = await event({}, { capacity: 2 });
  await eventStatus(db, admin, e.id, "published");
  const en = await entry(e.category.id, 5);
  const pid = await submitPayment(
    db,
    people[5],
    en.id,
    {
      reference: "TEST-CORRECTION",
      payer_name: "Tester",
      paid_at: new Date().toISOString(),
    },
    "test",
  );
  const correction = await request(
    "/me/payments/" + pid + "/correction",
    5,
    "POST",
    { reason: "Wrong payer name" },
  );
  assert.equal(correction.status, 200);
  await assert.rejects(
    () => reviewPayment(db, admin, pid, true, "Checked"),
    /correction/,
  );
  assert.equal(
    (
      await request(
        "/admin/corrections/" + correction.json.data.id + "/resolve",
        "admin",
        "POST",
        {
          resolution: "Please resubmit corrected details",
          allow_resubmit: true,
        },
      )
    ).status,
    200,
  );
  assert.equal(
    (await db.query("SELECT status FROM entries WHERE id=$1", [en.id])).rows[0]
      .status,
    "payment_rejected",
  );
  assert.equal(
    (
      await request("/admin/payments/" + pid + "/refund", "admin", "POST", {
        reason: "Verified funds but entry withdrawn",
        bank_checked: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await db.query("SELECT status FROM entries WHERE id=$1", [en.id])).rows[0]
      .status,
    "withdrawn",
  );
  assert.equal(
    (await db.query("SELECT status FROM refunds WHERE entry_id=$1", [en.id]))
      .rows[0].status,
    "pending",
  );
});
test("Database export restores records and bracket links in an empty database and refuses overwrite", async () => {
  const backup = await exportData(db),
    restored = new PGlite();
  try {
    await restored.exec(
      await readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
    );
    const target: Database = {
      query: (q, p) => restored.query(q, p) as any,
      transaction: (fn) =>
        restored.transaction((tx) =>
          fn({ query: (q, p) => tx.query(q, p) as any }),
        ),
    };
    await restoreData(target, backup);
    assert.deepEqual(
      (await target.query("SELECT count(*)::int n FROM entries")).rows,
      (await db.query("SELECT count(*)::int n FROM entries")).rows,
    );
    assert.deepEqual(
      (await target.query("SELECT id,next_match FROM matches ORDER BY id"))
        .rows,
      (await db.query("SELECT id,next_match FROM matches ORDER BY id")).rows,
    );
    await assert.rejects(() => restoreData(target, backup), /empty/);
  } finally {
    await restored.close();
  }
});
test("Account deletion blocks active entries then anonymises personal details", async () => {
  assert.equal((await request("/me/account", 0, "DELETE")).status, 409);
  const res = await request("/me/account", 11, "DELETE");
  assert.equal(res.status, 200);
  const a = (
    await db.query("SELECT * FROM athletes WHERE id=$1", [athletes[11]])
  ).rows[0];
  assert.equal(a.name, "Deleted athlete");
  assert.equal(a.phone, "");
  assert.equal((await request("/me", 11)).status, 403);
});
