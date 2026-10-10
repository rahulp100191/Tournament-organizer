import { PGlite } from "@electric-sql/pglite";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import {
  saveProfile,
  saveEvent,
  eventStatus,
  register,
  submitPayment,
  type Account,
} from "../server/domain.js";
import type { Database } from "../server/db.js";
const pg = new PGlite();
await pg.exec(
  await readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
);
const db: Database = {
  query: (q, p) => pg.query(q, p) as any,
  transaction: (fn) =>
    pg.transaction((tx) => fn({ query: (q, p) => tx.query(q, p) as any })),
};
const admin: Account = {
    id: randomUUID(),
    email: "organiser@example.test",
    role: "admin",
  },
  athlete: Account = {
    id: randomUUID(),
    email: "athlete@example.test",
    role: "athlete",
  };
for (const a of [admin, athlete])
  await db.query(
    "INSERT INTO accounts(id,firebase_uid,email,role) VALUES($1,$2,$3,$4)",
    [a.id, a.id, a.email, a.role],
  );
const pid = await saveProfile(db, athlete, {
  kind: "self",
  name: "Aarav Sharma",
  dob: "1996-03-15",
  gender: "male",
  state: "Assam",
  city: "Guwahati",
  phone: "9999999999",
  is_public: true,
  sports: [
    {
      sport: "Futsal",
      level: "Amateur",
      years: 2,
      primary_sport: false,
      categories: ["team"],
      rankings: [],
    },
    {
      sport: "Badminton",
      level: "Amateur",
      years: 5,
      primary_sport: true,
      categories: ["singles", "doubles"],
      rankings: [],
    },
    {
      sport: "Pickleball",
      level: "Beginner",
      years: 1,
      primary_sport: false,
      categories: ["doubles"],
      rankings: [],
    },
  ],
});
const iso = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString();
const eid = await saveEvent(db, admin, {
  name: "Rally Guwahati Open",
  sport: "Badminton",
  city: "Guwahati",
  state: "Assam",
  venue: "Nehru Indoor Stadium",
  details: {
    description: "Community tournament for local athletes.",
    organizer_name: "Rally Test Organiser",
    contact_phone: "9999999999",
    contact_email: "organiser@example.test",
    address: "Nehru Indoor Stadium, Guwahati",
  },
  starts_at: iso(7),
  ends_at: iso(8),
  registration_deadline: iso(5),
  withdrawal_deadline: iso(4),
  age_cutoff: iso(7).slice(0, 10),
  refund_policy:
    "Full refunds before the withdrawal deadline. Admin records the bank refund.",
  rules:
    "Arrive 20 minutes early. Bring your racket. Fair play and court etiquette apply.",
  categories: [
    {
      name: "Open singles",
      entry_type: "singles",
      format: "knockout",
      capacity: 16,
      fee: 50000,
      min_age: 18,
      max_age: 60,
      gender: "any",
      levels: ["Amateur"],
      best_of: 3,
    },
  ],
});
await eventStatus(db, admin, eid, "published");
const cid = (
  await db.query("SELECT id FROM categories WHERE event_id=$1", [eid])
).rows[0].id;
const en = await register(db, athlete, {
  category_id: cid,
  athlete_id: pid,
  accepted_rules: true,
  idempotency_key: randomUUID(),
  emergency_contact: "Emergency 9999999999",
});
await submitPayment(
  db,
  athlete,
  en.id,
  {
    reference: "TEST-BROWSER-1001",
    payer_name: "Aarav Sharma",
    paid_at: new Date().toISOString(),
  },
  "test",
);
process.env.DATABASE_URL = "local-test-adapter";
process.env.ADMIN_EMAILS = admin.email;
const backend = createApp({
  db,
  authenticate: async (req) => {
    const a = req.headers.cookie?.includes("persona=admin") ? admin : athlete;
    return { uid: a.id, email: a.email, verified: true };
  },
}).listen(3002, "127.0.0.1");
const vite = await createServer({
  server: {
    port: 5175,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3002" },
  },
});
await vite.listen();
console.log(
  "Fixture and Vite ready",
  (await fetch("http://127.0.0.1:5175")).status,
);
const browser = await chromium.launch();
await mkdir("preview/real-app", { recursive: true });
const errors: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5175", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Rally Guwahati Open" }).waitFor();
  assert.equal(await page.getByText("Preview ready").count(), 0);
  await page.screenshot({
    path: "preview/real-app/discover-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "View event" }).click();
  await page
    .getByRole("heading", { name: "Everything before you enter" })
    .waitFor();
  await page.screenshot({
    path: "preview/real-app/event-desktop.png",
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:5175/tests/ui.html", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "My Rally" }).waitFor();
  await page
    .getByText("Awaiting payment verification", { exact: true })
    .waitFor();
  await page.screenshot({
    path: "preview/real-app/athlete-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "profiles", exact: true }).click();
  await page.getByRole("heading", { name: "Aarav Sharma" }).waitFor();
  await page.screenshot({
    path: "preview/real-app/profile-desktop.png",
    fullPage: true,
  });
  await context.addCookies([
    { name: "persona", value: "admin", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("http://127.0.0.1:5175/tests/ui.html?role=admin", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "Tournament operations" }).waitFor();
  await page.screenshot({
    path: "preview/real-app/admin-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "payments", exact: true }).click();
  await page.getByRole("heading", { name: "Rally Guwahati Open" }).waitFor();
  await page
    .getByLabel("Reason / verification note")
    .fill("Verified test transaction");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Record decision" }).click();
  await page.getByText("TEST · confirmed", { exact: true }).waitFor();
  assert.equal(
    (await db.query("SELECT status FROM entries WHERE id=$1", [en.id])).rows[0]
      .status,
    "confirmed",
  );
  await page.screenshot({
    path: "preview/real-app/admin-payments.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create tournament", exact: true })
    .click();
  await page.getByRole("heading", { name: "Draft a tournament" }).waitFor();
  await page
    .getByLabel("Tournament name", { exact: true })
    .fill("Browser Futsal Team Cup");
  await page.getByLabel("City", { exact: true }).fill("Guwahati");
  await page.getByLabel("State", { exact: true }).fill("Assam");
  await page.getByLabel("Venue", { exact: true }).fill("Community Ground");
  await page.getByLabel("Sport", { exact: true }).fill("Futsal");
  for (const [label, days] of [
    ["Starts", 7],
    ["Ends", 8],
    ["Registration deadline", 5],
    ["Withdrawal deadline", 4],
  ] as const)
    await page.getByLabel(label, { exact: true }).fill(iso(days).slice(0, 16));
  await page.getByLabel("Published age cutoff").fill(iso(7).slice(0, 10));
  await page
    .getByLabel("Tournament description")
    .fill("A community competition with full team registration.");
  await page
    .getByLabel("Organiser / organisation")
    .fill("Rally Test Organiser");
  await page.getByLabel("Public organiser phone").fill("9999999999");
  await page
    .getByLabel("Public organiser email")
    .fill("organiser@example.test");
  await page
    .getByLabel("Full venue address")
    .fill("Community Ground, Guwahati");
  await page
    .getByLabel("Rules", { exact: true })
    .fill(
      "Five players on court. Resolve knockout ties using penalties. Bring shoes.",
    );
  await page
    .getByLabel("Refund and withdrawal policy")
    .fill("Full refund before the withdrawal deadline.");
  await page.getByLabel("Entry type").selectOption("team");
  await page.getByLabel("Category name", { exact: true }).fill("Open teams");
  await page.getByLabel("Minimum roster size").fill("3");
  await page.getByLabel("Maximum roster size").fill("5");
  await page.screenshot({
    path: "preview/real-app/admin-event-form.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const teamCard = page
    .locator("section.panel")
    .filter({
      has: page.getByRole("heading", {
        name: "Browser Futsal Team Cup",
        exact: true,
      }),
    });
  await teamCard
    .getByRole("button", { name: "Publish", exact: true })
    .waitFor();
  const teamEvent = (
    await db.query(
      "SELECT id,status FROM events WHERE name='Browser Futsal Team Cup'",
    )
  ).rows[0];
  assert.equal(teamEvent.status, "draft");
  assert.ok(
    !(
      await (await fetch("http://127.0.0.1:3002/api/v1/events")).json()
    ).data.some((event: any) => event.id === teamEvent.id),
  );
  await teamCard.getByRole("button", { name: "Publish", exact: true }).click();
  await teamCard
    .getByRole("button", { name: "Close entries", exact: true })
    .waitFor();
  assert.ok(
    (
      await (await fetch("http://127.0.0.1:3002/api/v1/events")).json()
    ).data.some((event: any) => event.id === teamEvent.id),
  );
  await context.clearCookies();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5175/tests/ui.html?event=" + teamEvent.id);
  await page.getByLabel("Team name (public)").fill("Rally Browser Team");
  await page
    .getByLabel("Emergency contact name and phone")
    .fill("Emergency 9999999999");
  await page.getByRole("checkbox").check();
  await page.screenshot({
    path: "preview/real-app/team-registration-phone.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Create team & invite players", exact: true })
    .click();
  await page
    .getByText("Invite players to Rally Browser Team", { exact: true })
    .waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "preview/real-app/team-invitation-phone.png",
    fullPage: true,
  });
  console.log(
    "Browser admin creation → draft privacy → publish → public discovery → captain team registration → roster invitations passed.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:5175", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Rally Guwahati Open" }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "preview/real-app/discover-phone.png",
    fullPage: true,
  });
  await context.addCookies([
    { name: "persona", value: "athlete", domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("http://127.0.0.1:5175/tests/ui.html", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("heading", { name: "My Rally" }).waitFor();
  await page.getByText("confirmed", { exact: true }).waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "preview/real-app/athlete-phone.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Add athlete" }).click();
  await page.getByLabel("Profile type").selectOption("junior");
  await page.getByLabel("Guardian name").waitFor();
  await page.screenshot({
    path: "preview/real-app/junior-phone.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "Browser → API → PostgreSQL payment verification passed; public, athlete, admin and phone screens verified.",
  );
} finally {
  await browser.close();
  await vite.close();
  backend.close();
  await pg.close();
}
