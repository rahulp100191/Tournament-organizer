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
console.log("Fixture and Vite ready",(await fetch("http://127.0.0.1:5175")).status);
const browser = await chromium.launch();
await mkdir("preview/real-app", { recursive: true });
const errors: string[] = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1080 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
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
  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await page.getByRole("heading", { name: "Draft a tournament" }).waitFor();
  await page.screenshot({
    path: "preview/real-app/admin-event-form.png",
    fullPage: true,
  });
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
